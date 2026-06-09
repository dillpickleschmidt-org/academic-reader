import { Cause, Effect } from "effect"
import { getVoice, TTS_SAMPLE_RATE } from "@academic-reader/api-client/schemas/tts"
import type { StorageService } from "./storage"
import { documentLocation, documentPrefix } from "../documents/document-storage"
import type { TTSBackend, TtsServiceShape } from "./backends/tts"
import type { ConvexServerSession } from "./convex-client"
import { pcmToWav } from "../utils/pcm-to-wav"
import {
  emitStreamingEvent,
  type WideEvent,
} from "../middleware/wide-event"

let activeGenerationKey: string | null = null

interface GenerateDocumentAudioOptions {
  convex: ConvexServerSession
  storage: StorageService
  ttsService: TtsServiceShape
  documentId: string
  voiceId: string
  ttsBackend: "local" | "modal"
  documentPath?: string
  event?: WideEvent
  onProgress?: (stats: DocumentAudioGenerationStats) => Promise<void> | void
  onComplete?: (stats: DocumentAudioGenerationStats) => Promise<void> | void
  onFailure?: (error: string) => Promise<void> | void
}

interface DocumentAudioGenerationStats {
  requestedBlocks: number
  generatedBlocks: number
  cleanupError?: string
}

type StartGenerationResult =
  | { started: true }
  | {
      started: false
      reason: "complete" | "busy" | "alreadyGenerating"
    }

interface ChunkForAudio {
  blockId: string
  ttsText: string
  order: number
}

export function startDocumentAudioGeneration(
  options: GenerateDocumentAudioOptions,
): StartGenerationResult {
  const key = `${options.documentId}:${options.voiceId}`

  if (activeGenerationKey === key) {
    return { started: false, reason: "alreadyGenerating" }
  }

  if (activeGenerationKey !== null) {
    return { started: false, reason: "busy" }
  }

  activeGenerationKey = key
  const start = performance.now()
  void Effect.runPromise(
    generateDocumentAudio(options).pipe(
      Effect.tap((stats) =>
        Effect.promise(async () => {
          if (options.event) {
            emitStreamingEvent(options.event, {
              durationMs: Math.round(performance.now() - start),
              status: 200,
              ...stats,
            })
          }
          await options.onComplete?.(stats)
        }),
      ),
      Effect.catchAllCause((cause) =>
        Effect.promise(async () => {
          const message = Cause.pretty(cause)
          if (options.event) {
            emitStreamingEvent(options.event, {
              durationMs: Math.round(performance.now() - start),
              status: 500,
              error: {
                category: "internal",
                message,
                code: "AUDIO_GENERATION_FAILED",
              },
            })
          }
          await options.onFailure?.(message)
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (activeGenerationKey === key) activeGenerationKey = null
        }),
      ),
    ),
  )

  return { started: true }
}

function generateDocumentAudio(
  options: GenerateDocumentAudioOptions,
): Effect.Effect<DocumentAudioGenerationStats, Error> {
  return Effect.gen(function* () {
    const voice = getVoice(options.voiceId)
    if (!voice) {
      return yield* Effect.fail(new Error(`Unknown voice: ${options.voiceId}`))
    }

    const generationState = yield* Effect.tryPromise({
      try: () =>
        options.convex.getTtsGenerationState(
          options.documentId,
          options.voiceId,
        ),
      catch: (e) => e as Error,
    })
    const doc = generationState.document
    const location = documentLocation(doc, doc.documentId)
    const documentPath = options.documentPath ?? documentPrefix(location)

    if (!generationState.ttsReady) {
      return yield* Effect.fail(new Error("TTS text is not ready yet"))
    }

    const missing = generationState.missingChunks.sort(
      (a, b) => a.order - b.order,
    )
    const stats: DocumentAudioGenerationStats = {
      requestedBlocks: missing.length,
      generatedBlocks: 0,
    }

    if (!missing.length) return stats

    yield* Effect.gen(function* () {
      yield* options.ttsService.activateWorker(voice.engine)
      const backend = yield* options.ttsService.createBackend(options.voiceId)

      for (const chunk of missing) {
        yield* generateChunkAudio(options, backend, documentPath, chunk)
        stats.generatedBlocks++
        if (options.onProgress) {
          yield* Effect.promise(() =>
            Promise.resolve(options.onProgress?.({ ...stats })),
          ).pipe(Effect.ignore)
        }
      }
    }).pipe(
      Effect.ensuring(
        options.ttsBackend === "local"
          ? options.ttsService.unloadWorker(voice.engine).pipe(
              Effect.catchAll((err) =>
                Effect.sync(() => {
                  stats.cleanupError =
                    err instanceof Error ? err.message : String(err)
                }),
              ),
            )
          : Effect.succeed(undefined),
      ),
    )

    return stats
  })
}

function generateChunkAudio(
  options: GenerateDocumentAudioOptions,
  backend: TTSBackend,
  documentPath: string,
  chunk: ChunkForAudio,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => backend.synthesize(chunk.ttsText),
      catch: (e) => e as Error,
    })

    if (!result.audio.length) {
      return yield* Effect.fail(new Error("TTS worker returned no audio"))
    }

    const wavBuffer = pcmToWav(result.audio, TTS_SAMPLE_RATE)
    const storagePath = `${documentPath}/audio/${options.voiceId}/${chunk.blockId.replace(/\//g, "_")}.wav`

    yield* options.storage.saveFile(storagePath, wavBuffer, {
      contentType: "audio/wav",
      cacheControl: "private, max-age=31536000, immutable",
    })

    yield* Effect.tryPromise({
      try: () =>
        options.convex.createTtsAudio({
          documentId: options.documentId,
          blockId: chunk.blockId,
          voiceId: options.voiceId,
          storagePath,
          durationMs: Math.round(
            (result.audio.length / 2 / TTS_SAMPLE_RATE) * 1000,
          ),
          sampleRate: TTS_SAMPLE_RATE,
          wordTimestamps: result.wordTimestamps,
        }),
      catch: (e) => e as Error,
    })
  })
}
