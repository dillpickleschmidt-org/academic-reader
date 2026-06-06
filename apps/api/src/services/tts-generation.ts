import { Effect } from "effect"
import { getVoice, TTS_SAMPLE_RATE } from "@academic-reader/api-client/schemas/tts"
import type { StorageService } from "./storage"
import type { TTSBackend, TtsServiceShape } from "./backends/tts"
import type { ConvexServerSession } from "./convex-client"
import { pcmToWav } from "../utils/pcm-to-wav"

let activeGenerationKey: string | null = null

export interface GenerateDocumentAudioOptions {
  convex: ConvexServerSession
  storage: StorageService
  ttsService: TtsServiceShape
  documentId: string
  voiceId: string
  backendMode: string
  documentPath?: string
}

export type StartGenerationResult =
  | { started: true }
  | {
      started: false
      complete?: boolean
      busy?: boolean
      alreadyGenerating?: boolean
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
    return { started: false, alreadyGenerating: true }
  }

  if (activeGenerationKey !== null) {
    return { started: false, busy: true }
  }

  activeGenerationKey = key
  void Effect.runPromise(
    generateDocumentAudio(options).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.warn("[tts-generation] Document generation failed:", err)
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

export function generateDocumentAudio(options: GenerateDocumentAudioOptions) {
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
    const documentPath =
      options.documentPath ?? `documents/${doc.userId}/${doc.storageId}`

    if (!generationState.ttsReady) {
      return yield* Effect.fail(new Error("TTS text is not ready yet"))
    }

    const missing = generationState.missingChunks.sort(
      (a, b) => a.order - b.order,
    )
    if (!missing.length) return

    yield* Effect.gen(function* () {
      yield* options.ttsService.activateWorker(voice.engine)
      const backend = yield* options.ttsService.createBackend(options.voiceId)

      for (const chunk of missing) {
        yield* generateChunkAudio(
          options,
          backend,
          documentPath,
          chunk,
        ).pipe(
          Effect.catchAll((err) =>
            Effect.sync(() => {
              console.warn(
                `[tts-generation] Block ${chunk.blockId} failed:`,
                err,
              )
            }),
          ),
        )
      }
    }).pipe(
      Effect.ensuring(
        options.backendMode === "local"
          ? options.ttsService.unloadWorker(voice.engine).pipe(Effect.ignore)
          : Effect.succeed(undefined),
      ),
    )
  })
}

function generateChunkAudio(
  options: GenerateDocumentAudioOptions,
  backend: TTSBackend,
  documentPath: string,
  chunk: ChunkForAudio,
) {
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
      cacheControl: "public, max-age=31536000, immutable",
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
