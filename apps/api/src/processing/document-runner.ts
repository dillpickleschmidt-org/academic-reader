import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type { Doc } from "@academic-reader/convex/convex/_generated/dataModel"
import type { AppConfigShape } from "../config"
import type { StorageService } from "../services/storage"
import type { ConversionBackendService } from "../services/backends/conversion"
import type { ConvexServerSession, ConvexSession } from "../services/convex-client"
import type { ModelProviderService } from "../services/model-provider"
import type { TtsServiceShape } from "../services/backends/tts"
import type { WideEvent } from "../middleware/wide-event"
import { emitStreamingEvent } from "../middleware/wide-event"
import type { DocumentLocation } from "../documents/document-storage"
import { promoteUploadedFile } from "./document-upload-promotion"
import {
  loadConversionResult,
  submitConversionJob,
  waitForConversion,
} from "./document-conversion"
import { persistConversionResult } from "./document-result-persistence"
import { startDocumentEnrichmentTasks } from "./document-enrichment-runner"
import { createDocumentTaskWriter } from "./document-task-writer"

interface StartDocumentProcessingOptions {
  config: AppConfigShape
  storage: StorageService
  backend: ConversionBackendService
  convex: ConvexSession
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
  void runDocumentProcessing(options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    void options.serverConvex
      .updateDocumentTask(options.conversionTaskId, {
        status: "failed",
        progress: null,
        error: message,
      })
      .catch(() => {})
    emitStreamingEvent(options.event, {
      status: 500,
      userId: options.userId,
      documentId: options.documentId,
      fileId: options.fileId,
      filename: options.filename,
      contentType: options.mimeType,
      backend: options.config.conversionBackend,
      conversionBackend: options.config.conversionBackend,
      ttsBackend: options.config.ttsBackend,
      processingMode: options.processingMode,
      useLlm: options.useLlm,
      forceOcr: options.forceOcr,
      error: {
        category: "internal",
        message,
        code: "DOCUMENT_PROCESSING_FAILED",
      },
    })
  })
}

async function runDocumentProcessing(options: StartDocumentProcessingOptions) {
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

  await taskWriter.startConversion(conversion)
  await promoteUploadedFile(options.storage, location, options.fileId)

  const backendJobId = await submitConversionJob({
    config: options.config,
    storage: options.storage,
    backend: options.backend,
    taskWriter,
    conversionTaskId: options.conversionTaskId,
    requestId: options.event.requestId,
    location,
    filename: options.filename,
    mimeType: options.mimeType,
    processingMode: options.processingMode,
    useLlm: options.useLlm,
    forceOcr: options.forceOcr,
    pageRange: options.pageRange,
  })

  await taskWriter.setConversionBackendJob(
    conversionDetails(options, backendJobId),
  )
  options.event.backendJobId = backendJobId

  try {
    const job = await waitForConversion(
      {
        backend: options.backend,
        taskWriter,
        conversionTaskId: options.conversionTaskId,
      },
      backendJobId,
    )
    const result = await loadConversionResult(options.storage, location, job)
    const processed = await persistConversionResult({
      config: options.config,
      storage: options.storage,
      convex: options.serverConvex,
      documentId: options.documentId,
      location,
      result,
    })

    await options.serverConvex.updateDocumentTask(options.conversionTaskId, {
      status: "succeeded",
      progress: null,
      error: null,
      conversion: conversionDetails(options, backendJobId),
    })

    emitStreamingEvent(options.event, {
      status: 200,
      userId: options.userId,
      documentId: options.documentId,
      fileId: options.fileId,
      filename: options.filename,
      contentType: options.mimeType,
      backend: options.config.conversionBackend,
      conversionBackend: options.config.conversionBackend,
      ttsBackend: options.config.ttsBackend,
      processingMode: options.processingMode,
      useLlm: options.useLlm,
      forceOcr: options.forceOcr,
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
  } catch (error) {
    await taskWriter.fail(options.conversionTaskId, error)
    throw error
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
