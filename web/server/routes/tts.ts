import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import type { Storage } from "../storage/types"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { createTTSBackend } from "../backends/tts/factory"
import {
  listAvailableVoiceSummaries,
  getEngineForVoice,
} from "../backends/tts/registry"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { env } from "../env"
import { activateWorker, WORKERS } from "../workers/registry"

function ttsAudioPath(userId: string, storageId: string, voiceId: string, blockId: string): string {
  return `documents/${userId}/${storageId}/audio/${voiceId}/${blockId.replace(/\//g, "_")}.wav`
}

interface TTSSynthesizeRequest {
  documentId: string
  blockId: string
  ttsText?: string
  voiceId?: string
}

interface CachedAudio {
  storagePath: string
  durationMs: number
  sampleRate: number
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>
}

type Variables = {
  storage: Storage
  userId: string
}

export const tts = new Hono<{ Variables: Variables }>()

tts.use("/tts/*", requireAuth)

/**
 * Synthesize audio for a chunk via SSE.
 * Streams PCM audio chunks as they're generated.
 */
tts.post("/tts/synthesize", async (c) => {
  const event = c.get("event")
  const storage = c.get("storage")
  const userId = c.get("userId")

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSSynthesizeRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { documentId, blockId, ttsText, voiceId = "female_1" } = bodyResult.data

  if (!documentId || !blockId) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId",
      code: "MISSING_FIELDS",
    }
    return c.json({ error: "Missing required fields" }, 400)
  }

  const docResult = await tryCatch(
    convex.query(api.api.documents.get, {
      documentId: documentId as Id<"documents">,
    }),
  )

  if (!docResult.success || !docResult.data) {
    event.error = {
      category: "validation",
      message: "Document not found",
      code: "DOCUMENT_NOT_FOUND",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  const doc = docResult.data

  const cachedAudioResult = await tryCatch(
    convex.query(api.api.ttsAudio.getBlockAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      voiceId,
    }),
  )

  const cachedAudio = cachedAudioResult.success
    ? (cachedAudioResult.data as CachedAudio | null)
    : null

  if (cachedAudio) {
    const audioUrl = await storage.getFileUrl(cachedAudio.storagePath)
    return c.json({
      audioUrl,
      text: ttsText || "",
      durationMs: cachedAudio.durationMs,
      sampleRate: cachedAudio.sampleRate,
      wordTimestamps: cachedAudio.wordTimestamps,
      cached: true,
    })
  }

  if (!ttsText) {
    event.error = {
      category: "validation",
      message: "ttsText required for uncached synthesis",
      code: "MISSING_TTS_TEXT",
    }
    return c.json({ error: "ttsText required for uncached synthesis" }, 400)
  }

  const engine = getEngineForVoice(voiceId)
  const workerActivation = activateWorker(engine)

  const streamStart = performance.now()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        sendEvent({ type: "progress", stage: "synthesizing" })
        sendEvent({ type: "text", text: ttsText })

        await workerActivation

        let backend
        try {
          backend = createTTSBackend(voiceId)
        } catch (error) {
          event.error = {
            category: "configuration",
            message: getErrorMessage(error),
            code: "TTS_BACKEND_CONFIG_ERROR",
          }
          sendEvent({ type: "error", error: "TTS backend configuration error" })
          controller.close()
          return
        }

        const pcmChunks: Uint8Array[] = []
        let latestWordTimestamps: Array<{ word: string; startMs: number; endMs: number }> = []

        for await (const chunk of backend.synthesizeStream(
          ttsText,
          voiceId,
        )) {
          if (chunk.type === "audio") {
            let data = chunk.data
            if (data.length > 0) {
              pcmChunks.push(data)
              sendEvent({
                type: "audio-chunk",
                data: Buffer.from(data).toString("base64"),
              })
            }
          } else if (chunk.type === "timestamps") {
            latestWordTimestamps = chunk.wordTimestamps
            sendEvent({
              type: "timestamps",
              wordTimestamps: chunk.wordTimestamps,
            })
          }
        }

        // Send completion event
        sendEvent({ type: "complete" })

        if (pcmChunks.length === 0) {
          console.warn("[tts] No audio chunks received, skipping cache")
          controller.close()
          return
        }

        const sampleRate = 24000
        const totalLen = pcmChunks.reduce((sum, c) => sum + c.length, 0)
        const concatenated = new Uint8Array(totalLen)
        let offset = 0
        for (const c of pcmChunks) {
          concatenated.set(c, offset)
          offset += c.length
        }
        const durationMs = Math.round((concatenated.length / 2 / sampleRate) * 1000)
        const wavBuffer = pcmToWav(concatenated, sampleRate)

        const storagePath = ttsAudioPath(userId, doc.storageId, voiceId, blockId)

        storage
          .saveFile(storagePath, wavBuffer, {
            contentType: "audio/wav",
            cacheControl: "public, max-age=31536000, immutable",
          })
          .then(() => {
            convex
              .mutation(api.api.ttsAudio.createAudio, {
                documentId: documentId as Id<"documents">,
                blockId,
                voiceId,
                storagePath,
                durationMs,
                sampleRate,
                wordTimestamps: latestWordTimestamps,
              })
              .catch((e) => {
                event.warning = {
                  message: getErrorMessage(e),
                  code: "TTS_AUDIO_CACHE_FAILED",
                }
              })
          })
          .catch((e) => {
            event.warning = {
              message: getErrorMessage(e),
              code: "STORAGE_SAVE_ERROR",
            }
          })
      } catch (e) {
        const errorMessage = getErrorMessage(e)
        event.error = {
          category: "backend",
          message: errorMessage,
          code: "TTS_STREAMING_ERROR",
        }
        sendEvent({ type: "error", error: errorMessage })
      }

      controller.close()
      emitStreamingEvent(event, {
        durationMs: Math.round(performance.now() - streamStart),
        status: event.error ? 500 : 200,
      })
    },
  })

  event.metadata = { blockId, voiceId }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})

interface TTSBatchRequest {
  documentId: string
  voiceId: string
  blocks: Array<{ blockId: string; ttsText: string }>
}

tts.post("/tts/batch", async (c) => {
  const storage = c.get("storage")
  const userId = c.get("userId")

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSBatchRequest>())
  if (!bodyResult.success) {
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { documentId, voiceId, blocks } = bodyResult.data

  if (!documentId || !voiceId || !blocks?.length) {
    return c.json({ error: "Missing required fields" }, 400)
  }

  const engine = getEngineForVoice(voiceId)
  if (engine !== "kokoro") {
    return c.json({ error: "Batch processing not yet available for this voice" }, 501)
  }

  const docResult = await tryCatch(
    convex.query(api.api.documents.get, {
      documentId: documentId as Id<"documents">,
    }),
  )

  if (!docResult.success || !docResult.data) {
    return c.json({ error: "Document not found" }, 404)
  }

  const doc = docResult.data

  const batchBlocks = blocks
    .filter((b) => b.ttsText.trim())
    .map((b) => ({ blockId: b.blockId, text: b.ttsText, voiceId }))

  if (!batchBlocks.length) {
    return c.json({ error: "No blocks could be processed" }, 400)
  }

  await activateWorker(engine)

  let backend
  try {
    backend = createTTSBackend(voiceId)
  } catch {
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  let processed = 0
  let failed = 0

  for await (const result of backend.synthesizeBatch(batchBlocks)) {
    if (c.req.raw.signal.aborted) break

    const wavBuffer = Buffer.from(result.audio, "base64")
    const storagePath = ttsAudioPath(userId, doc.storageId, voiceId, result.blockId)

    const saveResult = await tryCatch(
      storage.saveFile(storagePath, wavBuffer, {
        contentType: "audio/wav",
        cacheControl: "public, max-age=31536000, immutable",
      }),
    )

    if (!saveResult.success) {
      failed++
      continue
    }

    const convexResult = await tryCatch(
      convex.mutation(api.api.ttsAudio.createAudio, {
        documentId: documentId as Id<"documents">,
        blockId: result.blockId,
        voiceId,
        storagePath,
        durationMs: result.durationMs,
        sampleRate: result.sampleRate,
        wordTimestamps: result.wordTimestamps,
      }),
    )

    if (!convexResult.success) {
      failed++
      continue
    }

    processed++
  }

  return c.json({ success: true, processed, failed })
})

tts.get("/tts/voices", async (c) => {
  const voices = listAvailableVoiceSummaries()
  return c.json({ voices })
})

tts.post("/tts/unload", async (c) => {
  if (env.BACKEND_MODE !== "local") {
    return c.json({ unloaded: false, reason: "not local mode" })
  }

  const ttsWorkers = Object.entries(WORKERS).filter(
    ([, w]) => w.category === "tts",
  )
  const results: Record<string, boolean> = {}

  await Promise.all(
    ttsWorkers.map(async ([name, { url }]) => {
      const result = await tryCatch(fetch(`${url}/unload`, { method: "POST" }))
      results[name] = result.success && result.data.ok
    }),
  )

  return c.json({ unloaded: results })
})

/**
 * Prefetch audio for a chunk using non-streaming synthesis.
 * Used to pre-generate the next block's audio while streaming current block.
 */
tts.post("/tts/prefetch", async (c) => {
  const storage = c.get("storage")
  const userId = c.get("userId")

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSSynthesizeRequest>())
  if (!bodyResult.success) {
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { documentId, blockId, ttsText, voiceId = "female_1" } = bodyResult.data

  if (!documentId || !blockId || !ttsText) {
    return c.json({ error: "Missing required fields" }, 400)
  }

  const docResult = await tryCatch(
    convex.query(api.api.documents.get, {
      documentId: documentId as Id<"documents">,
    }),
  )

  if (!docResult.success || !docResult.data) {
    return c.json({ error: "Document not found" }, 404)
  }

  const doc = docResult.data

  // Check if already cached
  const cachedResult = await tryCatch(
    convex.query(api.api.ttsAudio.getBlockAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      voiceId,
    }),
  )

  if (cachedResult.success && cachedResult.data) {
    return c.json({ success: true, cached: true })
  }

  // Activate worker and create backend
  const engine = getEngineForVoice(voiceId)
  await activateWorker(engine)

  let backend
  try {
    backend = createTTSBackend(voiceId)
  } catch {
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  // Non-streaming synthesis
  const synthesisResult = await tryCatch(backend.synthesize(ttsText, voiceId))
  if (!synthesisResult.success) {
    return c.json({ error: "Synthesis failed" }, 500)
  }

  const { audio, sampleRate, durationMs, wordTimestamps } = synthesisResult.data

  // Save to S3
  const wavBuffer = Buffer.from(audio, "base64")
  const storagePath = ttsAudioPath(userId, doc.storageId, voiceId, blockId)

  const saveResult = await tryCatch(
    storage.saveFile(storagePath, wavBuffer, {
      contentType: "audio/wav",
      cacheControl: "public, max-age=31536000, immutable",
    }),
  )

  if (!saveResult.success) {
    return c.json({ error: "Storage save failed" }, 500)
  }

  // Save to Convex
  const convexResult = await tryCatch(
    convex.mutation(api.api.ttsAudio.createAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      voiceId,
      storagePath,
      durationMs,
      sampleRate,
      wordTimestamps,
    }),
  )

  if (!convexResult.success) {
    return c.json({ error: "Cache save failed" }, 500)
  }

  return c.json({ success: true, prefetched: true })
})

function pcmToWav(pcmData: Uint8Array, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const dataSize = pcmData.length
  const headerSize = 44
  const fileSize = headerSize + dataSize - 8

  const buffer = Buffer.alloc(headerSize + dataSize)

  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(fileSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  buffer.set(pcmData, 44)

  return buffer
}
