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
import { runTrackedTask, type DocumentTaskWriter } from "./document-task-writer"
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

function runOptionalEnrichmentTask(
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
  kind: "toc" | "summary" | "tts-prep",
  run: (taskId: string) => Promise<void>,
) {
  const startTimeMs = performance.now()
  return runTrackedTask(
    options.taskWriter,
    kind,
    (taskId) => run(taskId),
    {
      onFailure: (taskId, error) =>
        emitOptionalTaskFailure(options, kind, taskId, startTimeMs, error),
    },
  )
}

async function runTtsTasks(options: Parameters<typeof startDocumentEnrichmentTasks>[0]) {
  await runOptionalEnrichmentTask(options, "tts-prep", () =>
    runEnrichmentEffect(
      options,
      prepareTtsChunks(
        options.chunks,
        options.documentId,
        options.serverConvex,
      ),
    ),
  )

  if (!options.audioVoiceId || options.config.ttsBackend === "none") return

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
      optionalTask: true,
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
        optionalTask: true,
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

function runEnrichmentEffect(
  options: Parameters<typeof startDocumentEnrichmentTasks>[0],
  effect: Effect.Effect<void, unknown, any>,
) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(AppConfig, options.config),
      Effect.provideService(Storage, options.storage),
      Effect.provideService(ModelProvider, options.modelProvider),
      Effect.provideService(TtsService, options.ttsService),
    ) as Effect.Effect<void, unknown, never>,
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
    {
      ...options.event,
      timestamp: new Date().toISOString(),
      method: "BACKGROUND",
      path: `/enrichment/${taskKind}`,
      startTimeMs,
      documentId: options.documentId,
      taskId,
      taskKind,
      optionalTask: true,
    },
    {
      status: 500,
      error: {
        category: "internal",
        message: error instanceof Error ? error.message : String(error),
        code: `${taskKind.toUpperCase().replace(/-/g, "_")}_FAILED`,
      },
    },
  )
}
