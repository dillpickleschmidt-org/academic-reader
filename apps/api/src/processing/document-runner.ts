import { Cause, Effect } from "effect"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type { Doc } from "@academic-reader/convex/convex/_generated/dataModel"
import type { AppConfigShape } from "../config"
import type { StorageService } from "../services/storage"
import type { ConversionBackendService } from "../services/backends/conversion"
import type { ConvexServerSession } from "../services/convex-client"
import type { ModelProviderService } from "../services/model-provider"
import type { TtsServiceShape } from "../services/backends/tts"
import type { WideEvent } from "../middleware/wide-event"
import { emitStreamingEvent } from "../middleware/wide-event"
import type { DocumentLocation } from "../documents/document-storage"
import { promoteUploadedFile } from "./document-upload-promotion"
import { waitForConversion } from "./document-conversion"
import { persistConversionResult } from "./document-result-persistence"
import { startDocumentEnrichmentTasks } from "./document-enrichment-runner"
import { createDocumentTaskWriter } from "./document-task-writer"

interface StartDocumentProcessingOptions {
  config: AppConfigShape
  storage: StorageService
  backend: ConversionBackendService
  serverConvex: ConvexServerSession
  modelProvider: ModelProviderService
  ttsService: TtsServiceShape
  event: WideEvent
  userId: string
  documentId: string
  conversionTaskId: string
  fileId: string
  filename: string
  mimeType: string
  processingMode: ProcessingMode
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  audioVoiceId: string | null
}

export function startDocumentProcessing(options: StartDocumentProcessingOptions) {
  Effect.runFork(
    runDocumentProcessing(options).pipe(
      Effect.catch((error) =>
        failDocumentProcessing(options, errorMessage(error)),
      ),
      Effect.catchCause((cause) =>
        failDocumentProcessing(options, Cause.pretty(cause)),
      ),
    ),
  )
}

function runDocumentProcessing(options: StartDocumentProcessingOptions) {
  return Effect.gen(function* () {
    const location: DocumentLocation = {
      userId: options.userId,
      documentId: options.documentId,
    }
    const taskWriter = createDocumentTaskWriter(
      options.serverConvex,
      options.documentId,
      options.conversionTaskId,
    )
    const conversion = conversionDetails(options, null)

    yield* Effect.tryPromise({
      try: () => taskWriter.startConversion(conversion),
      catch: toError,
    })
    yield* promoteUploadedFile(options.storage, location, options.fileId)

    const backendJobId = yield* options.backend.submitJob({
      requestId: options.event.requestId,
      location,
      filename: options.filename,
      mimeType: options.mimeType,
      processingMode: options.processingMode,
      useLlm: options.useLlm,
      forceOcr: options.forceOcr,
      pageRange: options.pageRange,
    })

    yield* Effect.tryPromise({
      try: () =>
        taskWriter.setConversionBackendJob(
          conversionDetails(options, backendJobId),
        ),
      catch: toError,
    })
    options.event.backendJobId = backendJobId

    const job = yield* waitForConversion(
      {
        backend: options.backend,
        taskWriter,
        conversionTaskId: options.conversionTaskId,
      },
      backendJobId,
    )
    const result = yield* options.backend.loadResult(location, job)
    const processed = yield* persistConversionResult({
      config: options.config,
      storage: options.storage,
      convex: options.serverConvex,
      documentId: options.documentId,
      location,
      result,
    })

    yield* Effect.tryPromise({
      try: () =>
        options.serverConvex.updateDocumentTask(options.conversionTaskId, {
          status: "succeeded",
          progress: null,
          error: null,
          conversion: conversionDetails(options, backendJobId),
        }),
      catch: toError,
    })

    yield* Effect.sync(() => {
      emitStreamingEvent(options.event, {
        status: 200,
        ...processingEventFields(options),
        backendJobId,
        chunkCount: processed.blocks.length,
        imageCount: processed.imageCount,
        htmlLength: processed.htmlLength,
        markdownLength: processed.markdownLength,
        pageMarkersExpected: processed.pageMarkerStats.expected,
        pageMarkersInjected: processed.pageMarkerStats.injected,
        katexFailureCount: processed.htmlProcessingStats.katexFailureCount,
      })

      startDocumentEnrichmentTasks({
        config: options.config,
        storage: options.storage,
        serverConvex: options.serverConvex,
        modelProvider: options.modelProvider,
        ttsService: options.ttsService,
        taskWriter,
        event: options.event,
        documentId: options.documentId,
        location,
        chunks: processed.blocks,
        textContent: result.formats.markdown,
        audioVoiceId: options.audioVoiceId,
      })
    })
  })
}

function failDocumentProcessing(
  options: StartDocumentProcessingOptions,
  message: string,
) {
  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        options.serverConvex.updateDocumentTask(options.conversionTaskId, {
          status: "failed",
          progress: null,
          error: message,
        }),
      catch: () => undefined,
    }).pipe(Effect.ignore)

    yield* Effect.sync(() => {
      emitStreamingEvent(options.event, {
        status: 500,
        ...processingEventFields(options),
        error: {
          category: "internal",
          message,
          code: "DOCUMENT_PROCESSING_FAILED",
        },
      })
    })
  })
}

function processingEventFields(options: StartDocumentProcessingOptions) {
  return {
    userId: options.userId,
    documentId: options.documentId,
    fileId: options.fileId,
    filename: options.filename,
    contentType: options.mimeType,
    conversionBackend: options.config.conversionBackend,
    ttsBackend: options.config.ttsBackend,
    processingMode: options.processingMode,
    useLlm: options.useLlm,
    forceOcr: options.forceOcr,
  }
}

function conversionDetails(
  options: StartDocumentProcessingOptions,
  backendJobId: string | null,
): NonNullable<Doc<"documentTasks">["conversion"]> {
  return {
    processingMode: options.processingMode,
    useLlm: options.useLlm,
    forceOcr: options.forceOcr,
    pageRange: options.pageRange,
    audioVoiceId: options.audioVoiceId,
    backendJobId,
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
