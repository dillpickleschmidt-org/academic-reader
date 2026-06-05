import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import { ValidationError } from "@academic-reader/api-client/errors"
import { requireAuth } from "../middleware/auth"
import { getEvent, emitStreamingEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { ConvexClient } from "../services/convex-client"
import { TtsService } from "../services/backends/tts"
import { VOICES } from "@academic-reader/api-client/schemas/tts"
import { AppConfig } from "../config"
import { pcmToWav } from "../utils/pcm-to-wav"

function ttsAudioPath(
  userId: string,
  storageId: string,
  voiceId: string,
  blockId: string,
): string {
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

interface TTSBatchRequest {
  documentId: string
  voiceId: string
  blocks: Array<{ blockId: string; ttsText: string }>
}

function getEngine(voiceId: string) {
  return VOICES.find((v) => v.id === voiceId)?.engine ?? "kokoro"
}

const WORKERS: Record<string, { url: string; category: string }> = {
  marker: { url: "http://marker:8000", category: "conversion" },
  lightonocr: { url: "http://lightonocr:8001", category: "conversion" },
}

export const ttsRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/synthesize",
    Effect.gen(function* () {
      const { userId } = yield* requireAuth
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const convexService = yield* ConvexClient
      const convex = yield* convexService.fromRequest()
      const request = yield* HttpServerRequest.HttpServerRequest
      const event = yield* getEvent
      const streamStart = performance.now()

      const body = (yield* request.json) as TTSSynthesizeRequest
      const { documentId, blockId, ttsText, voiceId = "female_1" } = body

      if (!documentId || !blockId) {
        emitStreamingEvent(event, {
          status: 400,
          durationMs: Math.round(performance.now() - streamStart),
        })
        return yield* new ValidationError({
          message: "Missing required fields: documentId, blockId",
        })
      }

      Object.assign(event, { documentId, blockId, voiceId })

      // Check document exists
      const rawDoc = yield* Effect.tryPromise({
        try: () => convex.query("api/documents:get" as any, { documentId }),
        catch: () => new Error("Document not found"),
      })
      const doc = rawDoc as unknown as { storageId: string } | null

      if (!doc) {
        event.error = {
          category: "convex",
          message: "Document not found",
          code: "DOC_NOT_FOUND",
        }
        emitStreamingEvent(event, {
          status: 404,
          durationMs: Math.round(performance.now() - streamStart),
        })
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      // Check cache
      const rawCached = yield* Effect.tryPromise({
        try: () =>
          convex.query("api/ttsAudio:getBlockAudio" as any, {
            documentId,
            blockId,
            voiceId,
          }),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))
      const cachedAudio = rawCached as CachedAudio | null

      if (cachedAudio) {
        const audioUrl = yield* storage.getFileUrl(cachedAudio.storagePath)
        emitStreamingEvent(event, {
          status: 200,
          durationMs: Math.round(performance.now() - streamStart),
          cached: true,
        } as Record<string, unknown>)
        return HttpServerResponse.unsafeJson({
          audioUrl,
          text: ttsText || "",
          durationMs: cachedAudio.durationMs,
          sampleRate: cachedAudio.sampleRate,
          wordTimestamps: cachedAudio.wordTimestamps,
          cached: true,
        })
      }

      if (!ttsText) {
        emitStreamingEvent(event, {
          status: 400,
          durationMs: Math.round(performance.now() - streamStart),
        })
        return yield* new ValidationError({
          message: "ttsText required for uncached synthesis",
        })
      }

      // Activate worker and create backend
      const engine = getEngine(voiceId)
      yield* ttsService.activateWorker(engine)
      const backend = yield* ttsService.createBackend(voiceId)

      // Stream synthesis via SSE
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          const sendEvent = (data: object) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            )
          }

          try {
            sendEvent({ type: "progress", stage: "synthesizing" })
            sendEvent({ type: "text", text: ttsText })

            const pcmChunks: Uint8Array[] = []
            let latestWordTimestamps: Array<{
              word: string
              startMs: number
              endMs: number
            }> = []

            for await (const chunk of backend.synthesizeStream(
              ttsText,
              voiceId,
            )) {
              const audio = chunk.type === "audio" ? chunk.audio ?? chunk.data : undefined
              if (audio) {
                const data = Buffer.from(audio, "base64")
                if (data.length > 0) {
                  pcmChunks.push(data)
                  sendEvent({
                    type: "audio-chunk",
                    data: audio,
                  })
                }
              } else if (chunk.type === "timestamps" && chunk.wordTimestamps) {
                latestWordTimestamps = chunk.wordTimestamps
                sendEvent({
                  type: "timestamps",
                  wordTimestamps: chunk.wordTimestamps,
                })
              }
            }

            sendEvent({ type: "complete" })

            if (pcmChunks.length === 0) {
              event.warning = {
                message: "No audio chunks received",
                code: "TTS_EMPTY_STREAM",
              }
              emitStreamingEvent(event, {
                status: 200,
                durationMs: Math.round(performance.now() - streamStart),
              })
              controller.close()
              return
            }

            // Concatenate and save
            const sampleRate = 24000
            const totalLen = pcmChunks.reduce((sum, c) => sum + c.length, 0)
            const concatenated = new Uint8Array(totalLen)
            let offset = 0
            for (const c of pcmChunks) {
              concatenated.set(c, offset)
              offset += c.length
            }
            const durationMs = Math.round(
              (concatenated.length / 2 / sampleRate) * 1000,
            )
            const wavBuffer = pcmToWav(concatenated, sampleRate)

            const storagePath = ttsAudioPath(
              userId,
              doc.storageId,
              voiceId,
              blockId,
            )

            void Effect.runPromise(
              storage
                .saveFile(storagePath, wavBuffer, {
                  contentType: "audio/wav",
                  cacheControl: "public, max-age=31536000, immutable",
                })
                .pipe(
                  Effect.flatMap(() =>
                    Effect.tryPromise({
                      try: () =>
                        convex.mutation("api/ttsAudio:createAudio" as any, {
                          documentId,
                          blockId,
                          voiceId,
                          storagePath,
                          durationMs,
                          sampleRate,
                          wordTimestamps: latestWordTimestamps,
                        }),
                      catch: (e) => e as Error,
                    }),
                  ),
                  Effect.catchAll(() => Effect.void),
                ),
            ).catch((e) =>
              console.warn("[tts] Cache save failed:", e),
            )

            emitStreamingEvent(event, {
              status: 200,
              durationMs: Math.round(performance.now() - streamStart),
            })
          } catch (e) {
            event.error = {
              category: "backend",
              message: e instanceof Error ? e.message : "Synthesis failed",
              code: "TTS_STREAM_ERROR",
            }
            emitStreamingEvent(event, {
              status: 500,
              durationMs: Math.round(performance.now() - streamStart),
            })
            sendEvent({
              type: "error",
              error: e instanceof Error ? e.message : "Synthesis failed",
            })
          }

          controller.close()
        },
      })

      return HttpServerResponse.fromWeb(
        new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
      )
    }),
  ),

  HttpRouter.post(
    "/batch",
    Effect.gen(function* () {
      const { userId } = yield* requireAuth
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const convexService = yield* ConvexClient
      const convex = yield* convexService.fromRequest()
      const request = yield* HttpServerRequest.HttpServerRequest

      const body = (yield* request.json) as TTSBatchRequest
      const { documentId, voiceId, blocks } = body

      if (!documentId || !voiceId || !blocks?.length) {
        return yield* new ValidationError({
          message: "Missing required fields",
        })
      }

      const engine = getEngine(voiceId)
      if (engine !== "kokoro") {
        return HttpServerResponse.unsafeJson(
          { error: "Batch processing not yet available for this voice" },
          { status: 501 },
        )
      }

      const rawBatchDoc = yield* Effect.tryPromise({
        try: () => convex.query("api/documents:get" as any, { documentId }),
        catch: () => new Error("Document not found"),
      })
      const doc = rawBatchDoc as unknown as { storageId: string } | null

      if (!doc) {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const batchBlocks = blocks
        .filter((b) => b.ttsText.trim())
        .map((b) => ({ blockId: b.blockId, text: b.ttsText }))

      if (!batchBlocks.length) {
        return yield* new ValidationError({
          message: "No blocks could be processed",
        })
      }

      yield* ttsService.activateWorker(engine)
      const backend = yield* ttsService.createBackend(voiceId)

      let processed = 0
      let failed = 0

      yield* Effect.tryPromise({
        try: async () => {
          for await (const result of backend.synthesizeBatch(
            batchBlocks,
            voiceId,
          )) {
            const wavBuffer = Buffer.from(result.audio, "base64")
            const storagePath = ttsAudioPath(
              userId,
              doc.storageId,
              voiceId,
              result.blockId,
            )

            try {
              await Effect.runPromise(
                storage.saveFile(storagePath, wavBuffer, {
                  contentType: "audio/wav",
                  cacheControl: "public, max-age=31536000, immutable",
                }),
              )
              await convex.mutation("api/ttsAudio:createAudio" as any, {
                documentId,
                blockId: result.blockId,
                voiceId,
                storagePath,
                durationMs: result.durationMs,
                sampleRate: result.sampleRate,
                wordTimestamps: result.wordTimestamps,
              })
              processed++
            } catch {
              failed++
            }
          }
        },
        catch: () => new Error("Batch synthesis failed"),
      })

      return HttpServerResponse.unsafeJson({ success: true, processed, failed })
    }),
  ),

  HttpRouter.post(
    "/unload",
    Effect.gen(function* () {
      const config = yield* AppConfig

      if (config.backendMode !== "local") {
        return HttpServerResponse.unsafeJson({
          unloaded: false,
          reason: "not local mode",
        })
      }

      const ttsWorkers = [
        { name: "qwen3", url: config.ttsWorkers.qwen3Url },
        { name: "kokoro", url: config.ttsWorkers.kokoroUrl },
      ]

      const results: Record<string, boolean> = {}

      yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            ttsWorkers.map(async ({ name, url }) => {
              try {
                const res = await fetch(`${url}/unload`, { method: "POST" })
                results[name] = res.ok
              } catch {
                results[name] = false
              }
            }),
          ),
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.void))

      return HttpServerResponse.unsafeJson({ unloaded: results })
    }),
  ),

  HttpRouter.post(
    "/prefetch",
    Effect.gen(function* () {
      const { userId } = yield* requireAuth
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const convexService = yield* ConvexClient
      const convex = yield* convexService.fromRequest()
      const request = yield* HttpServerRequest.HttpServerRequest

      const body = (yield* request.json) as TTSSynthesizeRequest
      const { documentId, blockId, ttsText, voiceId = "female_1" } = body

      if (!documentId || !blockId || !ttsText) {
        return yield* new ValidationError({
          message: "Missing required fields",
        })
      }

      const rawPrefetchDoc = yield* Effect.tryPromise({
        try: () => convex.query("api/documents:get" as any, { documentId }),
        catch: () => new Error("Document not found"),
      })
      const doc = rawPrefetchDoc as unknown as { storageId: string } | null

      if (!doc) {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      // Check if already cached
      const cached = yield* Effect.tryPromise({
        try: () =>
          convex.query("api/ttsAudio:getBlockAudio" as any, {
            documentId,
            blockId,
            voiceId,
          }),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (cached) {
        return HttpServerResponse.unsafeJson({ success: true, cached: true })
      }

      // Activate worker and create backend
      const engine = getEngine(voiceId)
      yield* ttsService.activateWorker(engine)
      const backend = yield* ttsService.createBackend(voiceId)

      // Non-streaming synthesis
      const result = yield* Effect.tryPromise({
        try: () => backend.synthesize(ttsText, voiceId),
        catch: () => new Error("Synthesis failed"),
      })

      // Save to S3
      const wavBuffer = Buffer.from(result.audio, "base64")
      const storagePath = ttsAudioPath(userId, doc.storageId, voiceId, blockId)

      yield* storage.saveFile(storagePath, wavBuffer, {
        contentType: "audio/wav",
        cacheControl: "public, max-age=31536000, immutable",
      })

      // Save to Convex
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/ttsAudio:createAudio" as any, {
            documentId,
            blockId,
            voiceId,
            storagePath,
            durationMs: result.durationMs,
            sampleRate: result.sampleRate,
            wordTimestamps: result.wordTimestamps,
          }),
        catch: () => new Error("Cache save failed"),
      })

      return HttpServerResponse.unsafeJson({ success: true, prefetched: true })
    }),
  ),
)
