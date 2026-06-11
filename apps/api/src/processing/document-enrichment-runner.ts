import { Cause, Effect } from "effect"
import type { AppConfigShape } from "../config"
import { AppConfig } from "../config"
import { Storage, type StorageService } from "../services/storage"
import { ModelProvider, type ModelProviderService } from "../services/model-provider"
import { TtsService, type TtsServiceShape } from "../services/backends/tts"
import type { ConvexServerSession } from "../services/convex-client"
import {
  emitStreamingEvent,
  type WideEvent,
} from "../middleware/wide-event"
import { originalFileKey } from "../documents/document-storage"
import type { DocumentLocation } from "../documents/document-storage"
import type { ChunkBlock } from "./chunk-normalizer"
import { prepareTtsChunks, summaryEnrichment, tocEnrichment } from "./enrichments"
import type { DocumentTaskWriter } from "./document-task-writer"
import { startDocumentAudioGeneration } from "../services/tts-generation"

interface EnrichmentOptions {
  config: AppConfigShape
  storage: StorageService
  serverConvex: ConvexServerSession
  modelProvider: ModelProviderService
  ttsService: TtsServiceShape
  taskWriter: DocumentTaskWriter
  event: WideEvent
  documentId: string
  location: DocumentLocation
  chunks: ChunkBlock[]
  textContent: string
  audioVoiceId: string | null
}

export function startDocumentEnrichmentTasks(options: EnrichmentOptions) {
  Effect.runFork(
    Effect.all(
      [
        runOptionalEnrichmentTask(options, "toc", () =>
          runEnrichmentEffect(
            options,
            tocEnrichment(
              options.documentId,
              options.serverConvex,
              originalFileKey(options.location),
              options.textContent,
            ),
          ),
        ),
        runOptionalEnrichmentTask(options, "summary", () =>
          runEnrichmentEffect(
            options,
            summaryEnrichment(
              options.chunks.map((chunk) => chunk.html).join("\n"),
              options.documentId,
              options.serverConvex,
            ),
          ),
        ),
        runTtsTasks(options),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.ignore),
  )
}

function runOptionalEnrichmentTask(
  options: EnrichmentOptions,
  kind: "toc" | "summary" | "tts-prep",
  run: (taskId: string) => Effect.Effect<Record<string, unknown>, unknown>,
) {
  return Effect.gen(function* () {
    const startTimeMs = performance.now()
    const taskIdResult = yield* Effect.tryPromise({
      try: () => options.taskWriter.createRunningTask(kind),
      catch: toError,
    }).pipe(Effect.result)

    if (taskIdResult._tag === "Failure") {
      yield* Effect.sync(() =>
        emitOptionalTaskFailure(
          options,
          kind,
          "unknown",
          startTimeMs,
          taskIdResult.failure,
        ),
      )
      return false
    }

    const taskId = taskIdResult.success
    const result = yield* run(taskId).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(new Error(Cause.pretty(cause))),
      ),
      Effect.result,
    )
    if (result._tag === "Failure") {
      yield* failOptionalTask(
        options,
        kind,
        taskId,
        startTimeMs,
        result.failure,
      )
      return false
    }

    const succeeded = yield* Effect.tryPromise({
      try: () => options.taskWriter.succeed(taskId),
      catch: toError,
    }).pipe(Effect.result)

    if (succeeded._tag === "Failure") {
      yield* failOptionalTask(
        options,
        kind,
        taskId,
        startTimeMs,
        succeeded.failure,
      )
      return false
    }

    yield* Effect.sync(() =>
      emitOptionalTaskSuccess(options, kind, taskId, startTimeMs, result.success),
    )
    return true
  })
}

function failOptionalTask(
  options: EnrichmentOptions,
  kind: "toc" | "summary" | "tts-prep",
  taskId: string,
  startTimeMs: number,
  error: unknown,
) {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => options.taskWriter.fail(taskId, error),
      catch: toError,
    }).pipe(Effect.ignore)
    yield* Effect.sync(() =>
      emitOptionalTaskFailure(options, kind, taskId, startTimeMs, error),
    )
  })
}

function runTtsTasks(options: EnrichmentOptions) {
  return Effect.gen(function* () {
    const prepSucceeded = yield* runOptionalEnrichmentTask(
      options,
      "tts-prep",
      () =>
        runEnrichmentEffect(
          options,
          prepareTtsChunks(
            options.chunks,
            options.documentId,
            options.serverConvex,
          ),
        ),
    )

    if (
      !prepSucceeded ||
      !options.audioVoiceId ||
      options.config.ttsBackend === "none"
    ) {
      return
    }

    const taskId = yield* Effect.tryPromise({
      try: () => options.taskWriter.createRunningTask("tts-audio"),
      catch: toError,
    })
    const audioEvent = {
      ...enrichmentEvent(options, "tts-audio", taskId, performance.now()),
      path: "/enrichment/audio-generation",
      voiceId: options.audioVoiceId,
      ttsBackend: options.config.ttsBackend,
    }
    const result = startDocumentAudioGeneration({
      convex: options.serverConvex,
      storage: options.storage,
      ttsService: options.ttsService,
      documentId: options.documentId,
      voiceId: options.audioVoiceId,
      ttsBackend: options.config.ttsBackend,
      event: audioEvent,
      onProgress: async (stats) => {
        await options.taskWriter.setProgress(taskId, {
          label: "Generating audio",
          current: stats.generatedBlocks,
          total: stats.requestedBlocks,
        })
      },
      onComplete: async () => {
        await options.taskWriter.succeed(taskId)
      },
      onFailure: async (error) => {
        await options.taskWriter.fail(taskId, error)
      },
    })

    if (result.started) return

    yield* Effect.sync(() => {
      emitStreamingEvent(
        audioEvent,
        {
          status: result.reason === "complete" ? 200 : 409,
          started: false,
          reason: result.reason,
          error:
            result.reason === "complete"
              ? undefined
              : {
                  category: "internal",
                  message: "Audio generation could not start",
                  code: "AUDIO_GENERATION_NOT_STARTED",
                },
        },
      )
    })

    yield* Effect.tryPromise({
      try: () =>
        result.reason === "complete"
          ? options.taskWriter.succeed(taskId)
          : options.taskWriter.fail(taskId, "Audio generation could not start"),
      catch: toError,
    })
  }).pipe(Effect.catch(() => Effect.void))
}

function runEnrichmentEffect<A, E>(
  options: EnrichmentOptions,
  effect: Effect.Effect<A, E, AppConfig | Storage | ModelProvider | TtsService>,
) {
  return effect.pipe(
    Effect.provideService(AppConfig, options.config),
    Effect.provideService(Storage, options.storage),
    Effect.provideService(ModelProvider, options.modelProvider),
    Effect.provideService(TtsService, options.ttsService),
  )
}

function emitOptionalTaskSuccess(
  options: EnrichmentOptions,
  taskKind: string,
  taskId: string,
  startTimeMs: number,
  stats: Record<string, unknown>,
) {
  emitStreamingEvent(
    enrichmentEvent(options, taskKind, taskId, startTimeMs),
    { status: 200, ...stats },
  )
}

function emitOptionalTaskFailure(
  options: EnrichmentOptions,
  taskKind: string,
  taskId: string,
  startTimeMs: number,
  error: unknown,
) {
  emitStreamingEvent(
    enrichmentEvent(options, taskKind, taskId, startTimeMs),
    {
      ...errorDetails(error),
      status: 500,
      error: {
        category: "internal",
        message: error instanceof Error ? error.message : String(error),
        code: `${taskKind.toUpperCase().replace(/-/g, "_")}_FAILED`,
      },
    },
  )
}

function enrichmentEvent(
  options: EnrichmentOptions,
  taskKind: string,
  taskId: string,
  startTimeMs: number,
): WideEvent {
  return {
    ...options.event,
    timestamp: new Date().toISOString(),
    method: "BACKGROUND",
    path: `/enrichment/${taskKind}`,
    startTimeMs,
    documentId: options.documentId,
    taskId,
    taskKind,
  }
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error) || !("details" in error)) return {}
  const details = (error as { details?: unknown }).details
  return details && typeof details === "object"
    ? (details as Record<string, unknown>)
    : {}
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
