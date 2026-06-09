import { Effect } from "effect"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type { AppConfigShape } from "../config"
import type { StorageService } from "../services/storage"
import type { ConversionBackendService, ConversionJob } from "../services/backends/conversion"
import type { DocumentTaskWriter } from "./document-task-writer"
import type { DocumentLocation } from "../documents/document-storage"
import { documentPrefix, originalFileKey, resultJsonKey } from "../documents/document-storage"

interface ConversionRunOptions {
  config: AppConfigShape
  storage: StorageService
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

export interface JobResultInput {
  content: string
  metadata: Record<string, unknown>
  formats: {
    html: string
    markdown: string
    chunks: { blocks?: unknown[] } | null
  }
  images: Record<string, string> | null
}

const POLLING_INTERVAL_MS = 1000
const MAX_POLLS = 1200

export async function submitConversionJob(options: ConversionRunOptions) {
  const baseInput = {
    fileId: options.location.documentId,
    requestId: options.requestId,
    documentId: options.location.documentId,
    userId: options.location.userId,
    processingMode: options.processingMode,
    useLlm: options.useLlm,
    forceOcr: options.forceOcr,
    pageRange: options.pageRange,
  }

  if (options.config.conversionBackend === "datalab") {
    const fileData = await Effect.runPromise(
      options.storage.readFile(originalFileKey(options.location)),
    )
    return Effect.runPromise(
      options.backend.submitJob({
        ...baseInput,
        fileData,
        filename: options.filename,
      }),
    )
  }

  const fileUrl = await Effect.runPromise(
    options.storage.getPresignedReadUrl(originalFileKey(options.location)),
  )
  return Effect.runPromise(
    options.backend.submitJob({
      ...baseInput,
      fileUrl,
      mimeType: options.mimeType,
      documentPath: documentPrefix(options.location),
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
  storage: StorageService,
  location: DocumentLocation,
  job: ConversionJob,
): Promise<JobResultInput> {
  if (job.s3Result) {
    const resultKey = resultJsonKey(location)
    const resultJson = await Effect.runPromise(storage.readFileAsString(resultKey))
    await Effect.runPromise(storage.deleteFile(resultKey))
    return normalizeConversionResult(JSON.parse(resultJson))
  }

  if (!job.result) {
    throw new Error("Conversion completed without a result")
  }

  return normalizeConversionResult(job.result)
}

function normalizeConversionResult(value: unknown): JobResultInput {
  if (!value || typeof value !== "object") {
    throw new Error("Conversion result is not an object")
  }

  const result = value as {
    content?: unknown
    metadata?: unknown
    formats?: {
      html?: unknown
      markdown?: unknown
      chunks?: unknown
    }
    images?: unknown
  }

  if (typeof result.content !== "string") {
    throw new Error("Conversion result is missing content")
  }
  if (!isRecord(result.metadata)) {
    throw new Error("Conversion result is missing metadata")
  }
  if (!result.formats || typeof result.formats !== "object") {
    throw new Error("Conversion result is missing formats")
  }
  if (typeof result.formats.html !== "string") {
    throw new Error("Conversion result is missing HTML")
  }
  if (typeof result.formats.markdown !== "string") {
    throw new Error("Conversion result is missing markdown")
  }

  const chunks = normalizeChunks(result.formats.chunks)
  const images = normalizeImages(result.images)

  return {
    content: result.content,
    metadata: result.metadata,
    formats: {
      html: result.formats.html,
      markdown: result.formats.markdown,
      chunks,
    },
    images,
  }
}

function normalizeChunks(value: unknown): { blocks?: unknown[] } | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error("Conversion chunks must be an object")
  if (value.blocks !== undefined && !Array.isArray(value.blocks)) {
    throw new Error("Conversion chunk blocks must be an array")
  }
  return { blocks: value.blocks }
}

function normalizeImages(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error("Conversion images must be an object")

  const images: Record<string, string> = {}
  for (const [key, image] of Object.entries(value)) {
    if (typeof image !== "string") {
      throw new Error(`Conversion image ${key} must be a string`)
    }
    images[key] = image
  }
  return images
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
