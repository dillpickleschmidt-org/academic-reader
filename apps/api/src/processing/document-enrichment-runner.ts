import { Effect } from "effect"
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
import { documentPrefix, originalFileKey } from "../documents/document-storage"
import type { DocumentLocation } from "../documents/document-storage"
import type { ChunkBlock } from "./chunk-normalizer"
import { prepareTtsChunks, summaryEnrichment, tocEnrichment } from "./enrichments"
import type { DocumentTaskWriter } from "./document-task-writer"
import { startDocumentAudioGeneration } from "../services/tts-generation"

export function startDocumentEnrichmentTasks(options: {
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
}) {
  void Promise.all([
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
  ]).catch(() => {})
}

async function runOptionalEnrichmentTask(
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
  kind: "toc" | "summary" | "tts-prep",
  run: (taskId: string) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  const startTimeMs = performance.now()
  const taskId = await options.taskWriter.createRunningTask(kind)

  try {
    const stats = await run(taskId)
    await options.taskWriter.succeed(taskId)
    emitOptionalTaskSuccess(options, kind, taskId, startTimeMs, stats)
    return true
  } catch (error) {
    await options.taskWriter.fail(taskId, error)
    emitOptionalTaskFailure(options, kind, taskId, startTimeMs, error)
    return false
  }
}

async function runTtsTasks(options: Parameters<typeof startDocumentEnrichmentTasks>[0]) {
  const prepSucceeded = await runOptionalEnrichmentTask(options, "tts-prep", () =>
    runEnrichmentEffect(
      options,
      prepareTtsChunks(
        options.chunks,
        options.documentId,
        options.serverConvex,
      ),
    ),
  )

  if (!prepSucceeded || !options.audioVoiceId || options.config.ttsBackend === "none") return

  const taskId = await options.taskWriter.createRunningTask("tts-audio")
  const result = startDocumentAudioGeneration({
    convex: options.serverConvex,
    storage: options.storage,
    ttsService: options.ttsService,
    documentId: options.documentId,
    voiceId: options.audioVoiceId,
    ttsBackend: options.config.ttsBackend,
    documentPath: documentPrefix(options.location),
    event: {
      ...options.event,
      timestamp: new Date().toISOString(),
      method: "BACKGROUND",
      path: "/enrichment/audio-generation",
      startTimeMs: performance.now(),
      documentId: options.documentId,
      taskId,
      taskKind: "tts-audio",
      voiceId: options.audioVoiceId,
      ttsBackend: options.config.ttsBackend,
    },
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

  if (!result.started) {
    emitStreamingEvent(
      {
        ...options.event,
        timestamp: new Date().toISOString(),
        method: "BACKGROUND",
        path: "/enrichment/audio-generation",
        startTimeMs: performance.now(),
        documentId: options.documentId,
        taskId,
        taskKind: "tts-audio",
        voiceId: options.audioVoiceId,
        ttsBackend: options.config.ttsBackend,
      },
      {
        status: result.reason === "complete" ? 200 : 409,
        started: false,
        reason: result.reason,
        error: result.reason === "complete"
          ? undefined
          : {
              category: "internal",
              message: "Audio generation could not start",
              code: "AUDIO_GENERATION_NOT_STARTED",
            },
      },
    )
    if (result.reason === "complete") await options.taskWriter.succeed(taskId)
    else await options.taskWriter.fail(taskId, "Audio generation could not start")
  }
}

function runEnrichmentEffect<A>(
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
  effect: Effect.Effect<A, unknown, any>,
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(AppConfig, options.config),
      Effect.provideService(Storage, options.storage),
      Effect.provideService(ModelProvider, options.modelProvider),
      Effect.provideService(TtsService, options.ttsService),
    ) as Effect.Effect<A, unknown, never>,
  )
}

function emitOptionalTaskSuccess(
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
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
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
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
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
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
  return details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {}
}
