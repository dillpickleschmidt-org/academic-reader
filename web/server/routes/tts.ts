import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import type { Storage } from "../storage/types"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { createTTSBackend } from "../backends/tts/factory"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { env } from "../env"

interface TTSChunkRequest {
  documentId: string
  blockId: string
  variation?: string
  voiceId?: string
}

/** Segment data returned from Convex query */
interface SegmentData {
  index: number
  text: string
}

/** Audio record from Convex */
interface AudioRecord {
  segmentIndex: number
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
 * Synthesize audio for all segments in a chunk via SSE.
 * Streams results back as each segment completes.
 */
tts.post("/tts/chunk", async (c) => {
  const event = c.get("event")
  const storage = c.get("storage")
  const userId = c.get("userId")

  // Create authenticated Convex client
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSChunkRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const {
    documentId,
    blockId,
    variation = "default",
    voiceId = "male_1",
  } = bodyResult.data

  if (!documentId || !blockId) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId",
      code: "MISSING_FIELDS",
    }
    return c.json({ error: "Missing required fields" }, 400)
  }

  // Get all segments for this block
  const segmentsResult = await tryCatch(
    convex.query(api.api.ttsSegments.getSegments, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
    }),
  )

  if (!segmentsResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(segmentsResult.error),
      code: "SEGMENTS_QUERY_ERROR",
    }
    return c.json({ error: "Failed to query segments" }, 500)
  }

  const segments = segmentsResult.data as SegmentData[]
  if (segments.length === 0) {
    event.error = {
      category: "validation",
      message: "No segments found for block",
      code: "NO_SEGMENTS",
    }
    return c.json({ error: "No segments found. Call /api/tts/rewrite first." }, 404)
  }

  // Get cached audio for this block/voice
  const cachedAudioResult = await tryCatch(
    convex.query(api.api.ttsSegments.getBlockAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
      voiceId,
    }),
  )

  const cachedAudio = cachedAudioResult.success
    ? (cachedAudioResult.data as AudioRecord[])
    : []
  const cachedIndices = new Set(cachedAudio.map((a) => a.segmentIndex))

  // Get document for storage path
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

  // Create TTS backend
  let backend
  try {
    backend = createTTSBackend()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "TTS_BACKEND_CONFIG_ERROR",
    }
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  // Segments that need synthesis
  const segmentsToSynthesize = segments.filter((s) => !cachedIndices.has(s.index))

  // Create SSE stream
  const streamStart = performance.now()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // 1. Emit cached segments immediately
        for (const cached of cachedAudio) {
          const audioUrl = await storage.getFileUrl(cached.storagePath)
          sendEvent({
            type: "segment",
            segmentIndex: cached.segmentIndex,
            audioUrl,
            durationMs: cached.durationMs,
            sampleRate: cached.sampleRate,
            wordTimestamps: cached.wordTimestamps,
            cached: true,
          })
        }

        // 2. If nothing to synthesize, we're done
        if (segmentsToSynthesize.length === 0) {
          sendEvent({ type: "done" })
          controller.close()
          emitStreamingEvent(event, {
            durationMs: Math.round(performance.now() - streamStart),
            status: 200,
          })
          return
        }

        // 3. Stream synthesis results
        const batchInput = segmentsToSynthesize.map((s) => ({
          index: s.index,
          text: s.text,
        }))

        for await (const result of backend.synthesizeBatch(batchInput, voiceId)) {
          if (result.error) {
            sendEvent({
              type: "error",
              segmentIndex: result.segmentIndex,
              error: result.error,
            })
            continue
          }

          // Save audio to S3
          const safeBlockId = blockId.replace(/\//g, "_")
          const storagePath = `documents/${userId}/${doc.storageId}/audio/${variation}/${voiceId}/${safeBlockId}-${result.segmentIndex}.wav`
          const audioBuffer = Buffer.from(result.audio!, "base64")

          const saveResult = await tryCatch(
            storage.saveFile(storagePath, audioBuffer, {
              contentType: "audio/wav",
              cacheControl: "public, max-age=31536000, immutable",
            }),
          )

          if (!saveResult.success) {
            sendEvent({
              type: "error",
              segmentIndex: result.segmentIndex,
              error: "Failed to save audio",
            })
            continue
          }

          // Create audio record in Convex (fire and forget)
          if (!result.wordTimestamps) {
            event.warning = {
              message: `Missing wordTimestamps for segment ${result.segmentIndex} - skipping cache`,
              code: "TTS_MISSING_TIMESTAMPS",
            }
          } else {
            convex
              .mutation(api.api.ttsSegments.createAudio, {
                documentId: documentId as Id<"documents">,
                blockId,
                variation,
                segmentIndex: result.segmentIndex,
                voiceId,
                storagePath,
                durationMs: result.durationMs!,
                sampleRate: result.sampleRate!,
                wordTimestamps: result.wordTimestamps,
              })
              .catch((e) => {
                event.warning = {
                  message: getErrorMessage(e),
                  code: "TTS_AUDIO_CACHE_FAILED",
                }
              })
          }

          // Get presigned URL and emit
          const audioUrl = await storage.getFileUrl(storagePath)
          sendEvent({
            type: "segment",
            segmentIndex: result.segmentIndex,
            audioUrl,
            durationMs: result.durationMs,
            sampleRate: result.sampleRate,
            wordTimestamps: result.wordTimestamps,
            cached: false,
          })
        }

        sendEvent({ type: "done" })
      } catch (e) {
        const errorMessage = getErrorMessage(e)
        event.error = {
          category: "backend",
          message: errorMessage,
          code: "TTS_STREAMING_ERROR",
        }
        sendEvent({
          type: "fatal",
          error: errorMessage,
        })
      }

      controller.close()
      emitStreamingEvent(event, {
        durationMs: Math.round(performance.now() - streamStart),
        status: event.error ? 500 : 200,
      })
    },
  })

  event.metadata = { blockId, voiceId, segmentCount: segments.length }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})

// Endpoint to list available voices
tts.get("/tts/voices", async (c) => {
  const event = c.get("event")

  let backend
  try {
    backend = createTTSBackend()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "TTS_BACKEND_CONFIG_ERROR",
    }
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  const voicesResult = await tryCatch(backend.listVoices())

  if (!voicesResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(voicesResult.error),
      code: "TTS_VOICES_ERROR",
    }
    return c.json({ error: "Failed to list voices" }, 500)
  }

  return c.json({ voices: voicesResult.data })
})

// Unload TTS model to free GPU memory (local mode only)
tts.post("/tts/unload", async (c) => {
  const event = c.get("event")

  if (env.BACKEND_MODE !== "local") {
    return c.json({ unloaded: false, reason: "not local mode" })
  }

  const ttsWorkerUrl = env.TTS_WORKER_URL
  const unloadResult = await tryCatch(
    fetch(`${ttsWorkerUrl}/unload`, { method: "POST" }),
  )

  if (!unloadResult.success || !unloadResult.data.ok) {
    event.error = {
      category: "backend",
      message: unloadResult.success
        ? `Worker returned ${unloadResult.data.status}`
        : getErrorMessage(unloadResult.error),
      code: "TTS_UNLOAD_ERROR",
    }
    return c.json({ unloaded: false, reason: "worker error" }, 500)
  }

  return c.json(await unloadResult.data.json())
})
