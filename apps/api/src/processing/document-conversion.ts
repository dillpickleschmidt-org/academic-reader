import { Effect } from "effect"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type {
  ConversionBackendService,
  ConversionJob,
  ConversionResult,
} from "../services/backends/conversion"
import type { DocumentTaskWriter } from "./document-task-writer"
import type { DocumentLocation } from "../documents/document-storage"

interface ConversionRunOptions {
  backend: ConversionBackendService
  taskWriter: DocumentTaskWriter
  conversionTaskId: string
  requestId: string
  location: DocumentLocation
  filename: string
  mimeType: string
  processingMode: ProcessingMode
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
}

export type JobResultInput = ConversionResult

const POLLING_INTERVAL_MS = 1000
const MAX_POLLS = 1200

export async function submitConversionJob(options: ConversionRunOptions) {
  return Effect.runPromise(
    options.backend.submitJob({
      fileId: options.location.documentId,
      requestId: options.requestId,
      documentId: options.location.documentId,
      userId: options.location.userId,
      location: options.location,
      filename: options.filename,
      mimeType: options.mimeType,
      processingMode: options.processingMode,
      useLlm: options.useLlm,
      forceOcr: options.forceOcr,
      pageRange: options.pageRange,
    }),
  )
}

export async function waitForConversion(
  options: Pick<ConversionRunOptions, "backend" | "taskWriter" | "conversionTaskId">,
  backendJobId: string,
): Promise<ConversionJob> {
  let lastProgressKey = ""

  for (let i = 0; i < MAX_POLLS; i++) {
    const job = await Effect.runPromise(options.backend.getJobStatus(backendJobId))

    if (job.progress) {
      const nextProgress = {
        label: job.progress.stage,
        current: job.progress.current,
        total: job.progress.total,
      }
      const key = `${nextProgress.label}:${nextProgress.current}:${nextProgress.total}`
      if (key !== lastProgressKey) {
        lastProgressKey = key
        await options.taskWriter.setProgress(
          options.conversionTaskId,
          nextProgress,
        )
      }
    }

    if (job.status === "completed") return job

    if (job.status === "failed") {
      throw new Error(job.error || "Conversion failed")
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
  }

  throw new Error("Conversion timed out")
}

export async function loadConversionResult(
  backend: ConversionBackendService,
  location: DocumentLocation,
  job: ConversionJob,
): Promise<JobResultInput> {
  return Effect.runPromise(backend.loadResult(location, job))
}
