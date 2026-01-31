import { Hono } from "hono"
import { generateText } from "ai"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import type { Storage } from "../storage/types"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { createTTSBackend } from "../backends/tts/factory"
import { listAvailableVoiceSummaries, getEngineForVoice } from "../backends/tts/registry"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { createChatModel } from "../providers/models"
import { stripHtmlForEmbedding } from "../services/embeddings"
import { env } from "../env"
import { activateWorker, WORKERS } from "../workers/registry"

const TTS_SYSTEM_PROMPT = `**Role & Output Rule**
You are an audio-preparation editor.
Your goal is to make the following be worded naturally for the read-aloud style of a TTS model, but with <10% being altered. Generally, you should return the text **word-for-word** except for the **four passes** below.
No summaries, no comments.

**Pass 1 – Remove Inline Citations**
\`[Author et al. 20XX]\` → \`\`

**Pass 2 – Read Aloud Math**
Convert LaTeX into plain English spoken equivalents. **Leave out no important variables and leave out no details that would change the meaning of the math**. Additionally, clarify the difference between uppercase and lowercase variables of the same letter if both are present in the same paragraph. To do this, use a "type descriptor" (such as "the set," "the graph," or "the matrix") and the word "capital" immediately before the variable name for uppercase versions. Use a type descriptor for the lowercase version as well.
Example 1: We provide a set of module prototypes $S=\{G_1, G_2, \\dots, G_{|S|}\}$ -> We provide a set of module prototypes, S, which contains elements G sub-one, G sub-two, and so on, up to the total number of items in the set.
*note that no descriptors are added because there are no lowercase s or g variables present.
Example 2: Each edge $e\\in E$ connects two nodes $n_1, n_2 \\in N$ and represents an individual branch segment $e=(n_1, n_2)$ -> Each edge e, which is an element of the edge set capital E, connects two nodes n sub-one and n sub-two, which are elements of the node set capital N, and represents an individual branch segment e equals the pair n sub-one and n sub-two.
*note that "edge e" and "edge set capital E" are used to clearly contrast the specific items against the collections.

**Pass 3 – Sentence Slicing**
If a sentence exceeds ~40 words, break it at an existing comma or conjunction; keep original punctuation.

**Pass 4 – Micro-Glue (mandatory)**
You should perform **glue word changes** wherever the cadence feels stilted **when read aloud**; do **as many or as few** as needed—no quota, no ceiling.
Never change verbs, adjectives, or technical nouns.

After these four passes, output the text only.

An example sentence:
Before:
A branch module is defined as a connected acyclic graph $G=(N,E)$ , where $N$ and $E$ are sets of nodes and edges (referred to as branch segments).
After:
A branch module is defined as a connected acyclic graph, G equals the set containing N and E, where N and E are sets of nodes and edges, referred to as branch segments.
`

interface TTSSynthesizeRequest {
  documentId: string
  blockId: string
  chunkHtml: string
  voiceId?: string
}

interface CachedAudio {
  text: string
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

  const { documentId, blockId, chunkHtml, voiceId = "male_1" } = bodyResult.data

  if (!documentId || !blockId || !chunkHtml) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId, chunkHtml",
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
      text: cachedAudio.text,
      durationMs: cachedAudio.durationMs,
      sampleRate: cachedAudio.sampleRate,
      wordTimestamps: cachedAudio.wordTimestamps,
      cached: true,
    })
  }

  const streamStart = performance.now()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        let variationText: string | null = null

        const existingTextResult = await tryCatch(
          convex.query(api.api.ttsAudio.getBlockVariationText, {
            documentId: documentId as Id<"documents">,
            blockId,
          }),
        )

        if (existingTextResult.success && existingTextResult.data) {
          variationText = existingTextResult.data
        } else {
          sendEvent({ type: "progress", stage: "rewriting" })

          const plainText = stripHtmlForEmbedding(chunkHtml)

          if (!plainText.trim()) {
            sendEvent({ type: "error", error: "No text content to synthesize" })
            controller.close()
            return
          }

          let model
          try {
            model = createChatModel()
          } catch (error) {
            event.error = {
              category: "configuration",
              message: getErrorMessage(error),
              code: "MODEL_CONFIG_ERROR",
            }
            sendEvent({ type: "error", error: "Server configuration error" })
            controller.close()
            return
          }

          const generateResult = await tryCatch(
            generateText({
              model,
              system: TTS_SYSTEM_PROMPT,
              prompt: plainText,
              providerOptions: {
                google: {
                  thinkingConfig: {
                    thinkingLevel: "minimal",
                  },
                },
              },
            }),
          )

          if (!generateResult.success) {
            event.error = {
              category: "backend",
              message: getErrorMessage(generateResult.error),
              code: "AI_GENERATE_ERROR",
            }
            sendEvent({ type: "error", error: "Failed to prepare text for speech" })
            controller.close()
            return
          }

          variationText = generateResult.data.text
        }

        sendEvent({ type: "progress", stage: "synthesizing" })

        const engine = getEngineForVoice(voiceId)
        await activateWorker(engine)

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

        // Collect all PCM chunks for caching
        const pcmChunks: Uint8Array[] = []
        let pendingByte: number | null = null

        // Stream audio chunks to client (ensuring even byte counts for int16)
        for await (const chunk of backend.synthesizeStream(variationText!, voiceId)) {
          let data = chunk
          if (pendingByte !== null) {
            data = new Uint8Array([pendingByte, ...chunk])
            pendingByte = null
          }
          if (data.length % 2 !== 0) {
            pendingByte = data[data.length - 1]
            data = data.slice(0, -1)
          }
          if (data.length > 0) {
            pcmChunks.push(data)
            sendEvent({
              type: "audio-chunk",
              data: Buffer.from(data).toString("base64"),
            })
          }
        }

        // Send completion event
        sendEvent({ type: "complete" })

        // Save combined audio to storage (non-blocking)
        const totalLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const combinedPcm = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of pcmChunks) {
          combinedPcm.set(chunk, offset)
          offset += chunk.length
        }

        const sampleRate = 24000
        const durationMs = Math.round((totalLength / 2 / sampleRate) * 1000)
        const wavBuffer = pcmToWav(combinedPcm, sampleRate)

        const storagePath = `documents/${userId}/${doc.storageId}/audio/${voiceId}/${blockId.replace(/\//g, "_")}.wav`

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
                text: variationText!,
                storagePath,
                durationMs,
                sampleRate,
                wordTimestamps: [],
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

tts.get("/tts/voices", async (c) => {
  const voices = listAvailableVoiceSummaries()
  return c.json({ voices })
})

tts.post("/tts/unload", async (c) => {
  if (env.BACKEND_MODE !== "local") {
    return c.json({ unloaded: false, reason: "not local mode" })
  }

  const ttsWorkers = Object.entries(WORKERS).filter(([, w]) => w.category === "tts")
  const results: Record<string, boolean> = {}

  await Promise.all(
    ttsWorkers.map(async ([name, { url }]) => {
      const result = await tryCatch(fetch(`${url}/unload`, { method: "POST" }))
      results[name] = result.success && result.data.ok
    }),
  )

  return c.json({ unloaded: results })
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
