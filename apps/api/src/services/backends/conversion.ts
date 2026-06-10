import { Context, Effect, Layer } from "effect"
import { BackendError, StorageError } from "@academic-reader/api-client/errors"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import { AppConfig } from "../../config"
import type { DocumentLocation } from "../../documents/document-storage"
import {
  originalFileKey,
  resultJsonKey,
} from "../../documents/document-storage"
import { Storage, type StorageService } from "../storage"

const TIMEOUT_MS = 30_000

type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"

interface ConversionInput {
  fileId: string
  requestId: string
  documentId: string
  userId: string
  location: DocumentLocation
  filename: string
  mimeType: string
  processingMode: ProcessingMode
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
}

interface ConversionProgress {
  stage: string
  current: number
  total: number
  elapsed?: number
}

export interface ConversionResult {
  content: string
  metadata: Record<string, unknown>
  formats: {
    html: string
    markdown: string
    chunks: { blocks?: unknown[] } | null
  }
  images: Record<string, string> | null
}

interface ChunkOutput {
  blocks: Array<{
    id: string
    block_type: string
    html: string
    polygon: number[][]
    bbox: number[]
    page: number
    section_hierarchy?: Record<string, string>
    images?: Record<string, string>
  }>
  page_info: Record<string, { bbox: number[]; polygon: number[][] }>
  metadata: Record<string, unknown>
}

export interface ConversionJob {
  jobId: string
  status: JobStatus
  result?: ConversionResult
  error?: string
  progress?: ConversionProgress
  s3Result?: boolean
}

export interface ConversionBackendService {
  readonly name: string
  submitJob(
    input: ConversionInput,
  ): Effect.Effect<string, BackendError | StorageError>
  getJobStatus(jobId: string): Effect.Effect<ConversionJob, BackendError>
  loadResult(
    location: DocumentLocation,
    job: ConversionJob,
  ): Effect.Effect<ConversionResult, BackendError | StorageError>
  supportsCancellation(): boolean
  cancelJob(jobId: string): Effect.Effect<boolean, BackendError>
}

export class ConversionBackend extends Context.Tag("ConversionBackend")<
  ConversionBackend,
  ConversionBackendService
>() {
  static Live = Layer.effect(
    ConversionBackend,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage

      switch (config.conversionBackend) {
        case "local":
          return createLocalBackend(storage)
        case "datalab":
          return createDatalabBackend(config.datalabApiKey ?? "", storage)
        case "modal":
          return createModalBackend(config.modal, storage)
      }
    }),
  )
}

type WorkerType = "marker" | "lightonocr" | "chandra"

function parseJobId(jobId: string): {
  worker: WorkerType
  rawId: string
} {
  if (jobId.startsWith("chandra:")) {
    return { worker: "chandra", rawId: jobId.slice(8) }
  }
  if (jobId.startsWith("lightonocr:")) {
    return { worker: "lightonocr", rawId: jobId.slice(11) }
  }
  if (jobId.startsWith("marker:")) {
    return { worker: "marker", rawId: jobId.slice(7) }
  }
  return { worker: "marker", rawId: jobId }
}

function normalizeConversionResult(value: unknown): ConversionResult {
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

  return {
    content: result.content,
    metadata: result.metadata,
    formats: {
      html: result.formats.html,
      markdown: result.formats.markdown,
      chunks: normalizeChunks(result.formats.chunks),
    },
    images: normalizeImages(result.images),
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

function createResultLoader(
  backend: string,
  storage: StorageService,
): ConversionBackendService["loadResult"] {
  return (location, job) =>
    Effect.gen(function* () {
      if (job.s3Result) {
        const resultKey = resultJsonKey(location)
        const resultJson = yield* storage.readFileAsString(resultKey)
        yield* storage.deleteFile(resultKey)
        return yield* decodeConversionResult(backend, () =>
          JSON.parse(resultJson),
        )
      }

      if (!job.result) {
        return yield* new BackendError({
          message: "Conversion completed without a result",
          backend,
        })
      }

      return yield* decodeConversionResult(backend, () => job.result)
    })
}

function decodeConversionResult(
  backend: string,
  read: () => unknown,
): Effect.Effect<ConversionResult, BackendError> {
  return Effect.try({
    try: () => normalizeConversionResult(read()),
    catch: (error) =>
      new BackendError({
        message: error instanceof Error ? error.message : String(error),
        backend,
      }),
  })
}

// Local Backend

const MARKER_URL = "http://marker:8000"
const LIGHTONOCR_URL = "http://lightonocr:8001"

interface LocalWorkerResponse {
  job_id: string
  status:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
  result?: ConversionResult
  error?: string
  progress?: ConversionProgress
}

const LOCAL_STATUS_MAP: Record<string, JobStatus> = {
  pending: "pending",
  processing: "processing",
  completed: "completed",
  failed: "failed",
  cancelled: "failed",
}

function createLocalBackend(storage: StorageService): ConversionBackendService {
  function getWorkerUrl(jobId: string): { baseUrl: string; rawJobId: string } {
    const { worker, rawId } = parseJobId(jobId)
    const baseUrl = worker === "lightonocr" ? LIGHTONOCR_URL : MARKER_URL
    return { baseUrl, rawJobId: rawId }
  }

  return {
    name: "local",

    submitJob: (input) =>
      Effect.gen(function* () {
        if (input.processingMode === "aggressive") {
          return yield* new BackendError({
            message:
              "[local] Aggressive mode requires modal backend (CHANDRA needs >16GB VRAM)",
            backend: "local",
          })
        }

        const fileUrl = yield* storage.getPresignedReadUrl(
          originalFileKey(input.location),
        )

        return yield* Effect.tryPromise({
          try: async () => {
            if (input.processingMode === "balanced") {
              const params = new URLSearchParams()
              params.set("file_url", fileUrl)
              params.set("mime_type", input.mimeType)
              if (input.pageRange) params.set("page_range", input.pageRange)

              const response = await fetch(
                `${LIGHTONOCR_URL}/convert?${params}`,
                {
                  method: "POST",
                  signal: AbortSignal.timeout(TIMEOUT_MS),
                },
              )
              if (!response.ok)
                throw new Error(
                  `[local] LightOnOCR submit failed: ${await response.text()}`,
                )
              const data = (await response.json()) as { job_id: string }
              return `lightonocr:${data.job_id}`
            }

            const params = new URLSearchParams({
              use_llm: String(input.useLlm),
              file_url: fileUrl,
            })
            if (input.forceOcr) params.set("force_ocr", "true")
            if (input.pageRange) params.set("page_range", input.pageRange)

            const response = await fetch(
              `${MARKER_URL}/convert/${input.fileId}?${params}`,
              {
                method: "POST",
                signal: AbortSignal.timeout(TIMEOUT_MS),
              },
            )
            if (!response.ok)
              throw new Error(
                `[local] Marker submit failed: ${await response.text()}`,
              )
            const data = (await response.json()) as { job_id: string }
            return `marker:${data.job_id}`
          },
          catch: (e) =>
            new BackendError({ message: String(e), backend: "local" }),
        })
      }),

    getJobStatus: (jobId) =>
      Effect.tryPromise({
        try: async () => {
          const { baseUrl, rawJobId } = getWorkerUrl(jobId)
          const response = await fetch(`${baseUrl}/jobs/${rawJobId}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          if (!response.ok)
            throw new Error(
              `[local] Failed to get job status: ${await response.text()}`,
            )
          const data = (await response.json()) as LocalWorkerResponse
          return mapLocalResponse(data)
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "local" }),
      }),

    loadResult: createResultLoader("local", storage),

    supportsCancellation: () => true,

    cancelJob: (jobId) =>
      Effect.tryPromise({
        try: async () => {
          const { baseUrl, rawJobId } = getWorkerUrl(jobId)
          const response = await fetch(`${baseUrl}/cancel/${rawJobId}`, {
            method: "POST",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          return response.ok
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "local" }),
      }),
  }
}

function mapLocalResponse(data: LocalWorkerResponse): ConversionJob {
  const status = LOCAL_STATUS_MAP[data.status] ?? "failed"
  const isComplete = status === "completed"
  const result = data.result
  if (isComplete && !result) {
    return {
      jobId: data.job_id,
      status: "failed",
      error: "Conversion completed without a result",
      progress: data.progress,
    }
  }

  return {
    jobId: data.job_id,
    status,
    result: isComplete ? result : undefined,
    error: data.error,
    progress: data.progress,
  }
}

// Datalab Backend

const DATALAB_TIMEOUT_MS = 300_000

interface DatalabResponse {
  request_id: string
  status: "pending" | "processing" | "complete" | "failed"
  success?: boolean
  markdown?: string
  html?: string
  json?: unknown
  chunks?: ChunkOutput
  error?: string
  images?: Record<string, string>
}

const DATALAB_STATUS_MAP: Record<string, JobStatus> = {
  pending: "pending",
  processing: "processing",
  complete: "completed",
  failed: "failed",
}

function createDatalabBackend(
  apiKey: string,
  storage: StorageService,
): ConversionBackendService {
  const baseUrl = "https://www.datalab.to/api/v1/marker"

  return {
    name: "datalab",

    submitJob: (input) =>
      Effect.gen(function* () {
        const fileData = yield* storage.readFile(originalFileKey(input.location))

        return yield* Effect.tryPromise({
          try: async () => {
            const formData = new FormData()
            const blob = new Blob([new Uint8Array(fileData)], {
              type: input.mimeType,
            })
            formData.append("file", blob, input.filename)
            formData.append("output_format", "html,markdown,json,chunks")
            formData.append("add_block_ids", "true")
            formData.append("mode", input.processingMode)
            if (input.forceOcr) formData.append("force_ocr", "true")
            if (input.pageRange) formData.append("page_range", input.pageRange)

            const response = await fetch(baseUrl, {
              method: "POST",
              headers: { "X-API-Key": apiKey },
              body: formData,
              signal: AbortSignal.timeout(DATALAB_TIMEOUT_MS),
            })
            if (!response.ok)
              throw new Error(
                `[datalab] Submit failed: ${await response.text()}`,
              )
            const data = (await response.json()) as { request_id: string }
            return data.request_id
          },
          catch: (e) =>
            new BackendError({ message: String(e), backend: "datalab" }),
        })
      }),

    getJobStatus: (jobId) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${baseUrl}/${jobId}`, {
            headers: { "X-API-Key": apiKey },
            signal: AbortSignal.timeout(DATALAB_TIMEOUT_MS),
          })
          if (!response.ok)
            throw new Error(
              `[datalab] Failed to get job status: ${await response.text()}`,
            )
          const data = (await response.json()) as DatalabResponse
          return mapDatalabResponse(data)
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "datalab" }),
      }),

    loadResult: createResultLoader("datalab", storage),

    supportsCancellation: () => false,
    cancelJob: () => Effect.succeed(false),
  }
}

function mapDatalabResponse(data: DatalabResponse): ConversionJob {
  const rawStatus =
    data.status === "complete" && data.success === false
      ? "failed"
      : data.status
  const status = DATALAB_STATUS_MAP[rawStatus] ?? "failed"
  const isComplete = status === "completed"
  const html = data.html
  const markdown = data.markdown
  const missingContent = isComplete && (!html || markdown === undefined)

  return {
    jobId: data.request_id,
    status: missingContent ? "failed" : status,
    result: isComplete && html && markdown !== undefined
      ? {
          content: html,
          metadata: {},
          formats: {
            html,
            markdown,
            chunks: data.chunks ?? null,
          },
          images: data.images ?? null,
        }
      : undefined,
    error: missingContent
      ? "Datalab completed without required html or markdown"
      : data.error,
  }
}

// Modal Backend

interface ModalEndpoints {
  markerUrl?: string
  lightonocrUrl?: string
  chandraUrl?: string
}

const MODAL_STATUS_MAP: Record<string, JobStatus> = {
  IN_PROGRESS: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
}

function createModalBackend(
  endpoints: ModalEndpoints,
  storage: StorageService,
): ConversionBackendService {
  function getEndpoint(worker: WorkerType): string | undefined {
    if (worker === "chandra") return endpoints.chandraUrl
    if (worker === "lightonocr") return endpoints.lightonocrUrl
    return endpoints.markerUrl
  }

  return {
    name: "modal",

    submitJob: (input) =>
      Effect.gen(function* () {
        const useChandra = input.processingMode === "aggressive"
        const useLightOnOcr = input.processingMode === "balanced"

        let workerType: WorkerType = "marker"
        if (useChandra) workerType = "chandra"
        else if (useLightOnOcr) workerType = "lightonocr"

        const endpoint = getEndpoint(workerType)
        if (!endpoint) {
          return yield* new BackendError({
            message: `[modal] ${workerType} worker is not configured`,
            backend: "modal",
          })
        }

        const fileUrl = yield* storage.getPresignedReadUrl(
          originalFileKey(input.location),
        )
        const resultKey = resultJsonKey(input.location)
        const { uploadUrl: resultUploadUrl } =
          yield* storage.getPresignedUploadUrl(resultKey)

        return yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${endpoint}/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                file_url: fileUrl,
                result_upload_url: resultUploadUrl,
                request_id: input.requestId,
                document_id: input.documentId,
                user_id: input.userId,
                use_llm: input.useLlm,
                force_ocr: input.forceOcr,
                page_range: input.pageRange || null,
              }),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            })
            if (!res.ok)
              throw new Error(`[modal] Submit failed: ${await res.text()}`)
            const data = (await res.json()) as { id: string }
            return `${workerType}:${data.id}`
          },
          catch: (e) =>
            new BackendError({ message: String(e), backend: "modal" }),
        })
      }),

    getJobStatus: (jobId) =>
      Effect.tryPromise({
        try: async () => {
          const { worker, rawId } = parseJobId(jobId)
          const endpoint = getEndpoint(worker)
          if (!endpoint)
            throw new Error(`[modal] ${worker} worker is not configured`)

          const res = await fetch(`${endpoint}/status/${rawId}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
          if (!res.ok)
            throw new Error(
              `[modal] Failed to get job status: ${await res.text()}`,
            )

          const data = (await res.json()) as {
            status: string
            output?: { s3_result?: boolean }
            error?: string
          }

          return {
            jobId,
            status: MODAL_STATUS_MAP[data.status] ?? ("pending" as JobStatus),
            s3Result: data.output?.s3_result,
            error: data.error,
          }
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "modal" }),
      }),

    loadResult: createResultLoader("modal", storage),

    supportsCancellation: () => false,
    cancelJob: () => Effect.succeed(false),
  }
}
