import { Context, Effect, Layer } from "effect"
import { BackendError } from "@academic-reader/api-client/errors"
import type { JobStatus } from "@academic-reader/api-client/schemas/common"
import { AppConfig } from "../../config"
import { Storage } from "../storage"
import { prefixJobId, parseJobId, type WorkerType } from "../job-file-map"

const TIMEOUT_MS = 30_000

export interface ConversionInput {
  fileId: string
  fileUrl?: string
  filename?: string
  mimeType?: string
  processingMode: string
  useLlm: boolean
  forceOcr?: boolean
  pageRange?: string
  documentPath?: string
  fileData?: Buffer
}

export interface ConversionProgress {
  stage: string
  current: number
  total: number
  elapsed?: number
}

export interface ConversionResult {
  content: string
  metadata: Record<string, unknown>
  formats?: {
    html: string
    markdown: string
    chunks?: ChunkOutput
  }
  images?: Record<string, string>
}

export interface ChunkOutput {
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
  htmlContent?: string
  error?: string
  progress?: ConversionProgress
  s3Result?: boolean
}

export interface ConversionBackendService {
  readonly name: string
  submitJob(input: ConversionInput): Effect.Effect<string, BackendError>
  getJobStatus(jobId: string): Effect.Effect<ConversionJob, BackendError>
  supportsStreaming(): boolean
  getStreamUrl(jobId: string): string | null
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

      switch (config.backendMode) {
        case "local":
          return createLocalBackend()
        case "datalab":
          return createDatalabBackend(config.datalabApiKey!)
        case "modal":
          return createModalBackend(config.modal, storage)
      }
    }),
  )
}

// Local Backend

const MARKER_URL = "http://marker:8000"
const LIGHTONOCR_URL = "http://lightonocr:8001"

interface LocalWorkerResponse {
  job_id: string
  status:
    | "pending"
    | "processing"
    | "html_ready"
    | "completed"
    | "failed"
    | "cancelled"
  result?: ConversionResult
  html_content?: string
  error?: string
  progress?: ConversionProgress
}

const LOCAL_STATUS_MAP: Record<string, JobStatus> = {
  pending: "pending",
  processing: "processing",
  html_ready: "html_ready",
  completed: "completed",
  failed: "failed",
  cancelled: "failed",
}

function createLocalBackend(): ConversionBackendService {
  function getWorkerUrl(jobId: string): { baseUrl: string; rawJobId: string } {
    const { worker, rawId } = parseJobId(jobId)
    const baseUrl = worker === "lightonocr" ? LIGHTONOCR_URL : MARKER_URL
    return { baseUrl, rawJobId: rawId }
  }

  return {
    name: "local",

    submitJob: (input) =>
      Effect.tryPromise({
        try: async () => {
          if (input.processingMode === "aggressive") {
            throw new Error(
              "[local] Aggressive mode requires modal backend (CHANDRA needs >16GB VRAM)",
            )
          }

          if (input.processingMode === "balanced") {
            const params = new URLSearchParams()
            if (input.fileUrl) params.set("file_url", input.fileUrl)
            if (input.mimeType) params.set("mime_type", input.mimeType)
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
            return prefixJobId(data.job_id, "lightonocr")
          }

          const params = new URLSearchParams({ use_llm: String(input.useLlm) })
          if (input.forceOcr) params.set("force_ocr", "true")
          if (input.pageRange) params.set("page_range", input.pageRange)
          if (input.fileUrl) params.set("file_url", input.fileUrl)

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
          return prefixJobId(data.job_id, "marker")
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "local" }),
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

    supportsStreaming: () => true,

    getStreamUrl: (jobId) => {
      const { baseUrl, rawJobId } = getWorkerUrl(jobId)
      return `${baseUrl}/jobs/${rawJobId}/stream`
    },

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

  return {
    jobId: data.job_id,
    status,
    htmlContent: data.html_content || result?.formats?.html,
    result:
      isComplete && result
        ? {
            content: result.content,
            metadata: result.metadata,
            formats: result.formats
              ? {
                  html: result.formats.html,
                  markdown: result.formats.markdown,
                  chunks: result.formats.chunks,
                }
              : undefined,
            images: result.images,
          }
        : undefined,
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

function createDatalabBackend(apiKey: string): ConversionBackendService {
  const baseUrl = "https://www.datalab.to/api/v1/marker"

  return {
    name: "datalab",

    submitJob: (input) =>
      Effect.tryPromise({
        try: async () => {
          if (!input.fileData)
            throw new Error("[datalab] fileData is required for direct upload")

          const formData = new FormData()
          const fileBytes = Buffer.isBuffer(input.fileData)
            ? new Uint8Array(input.fileData)
            : input.fileData
          const blob = new Blob([fileBytes], { type: "application/pdf" })
          formData.append("file", blob, input.filename || "document.pdf")
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
            throw new Error(`[datalab] Submit failed: ${await response.text()}`)
          const data = (await response.json()) as { request_id: string }
          return data.request_id
        },
        catch: (e) =>
          new BackendError({ message: String(e), backend: "datalab" }),
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

    supportsStreaming: () => false,
    getStreamUrl: () => null,
    supportsCancellation: () => false,
    cancelJob: () => Effect.succeed(false),
  }
}

function mapDatalabResponse(data: DatalabResponse): ConversionJob {
  const rawStatus =
    data.status === "complete" && !data.success ? "failed" : data.status
  const status = DATALAB_STATUS_MAP[rawStatus] ?? "failed"
  const isComplete = status === "completed"
  const rawHtml = data.html ?? ""

  return {
    jobId: data.request_id,
    status,
    htmlContent: isComplete ? rawHtml : undefined,
    result: isComplete
      ? {
          content: rawHtml,
          metadata: {},
          formats: {
            html: rawHtml,
            markdown: data.markdown ?? "",
            chunks: data.chunks,
          },
          images: data.images,
        }
      : undefined,
    error: data.error,
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
  storage: {
    getPresignedUploadUrl(
      key: string,
    ): Effect.Effect<{ uploadUrl: string; expiresAt: string }, any>
  },
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

        if (!input.documentPath) {
          return yield* new BackendError({
            message: "[modal] documentPath is required for result upload",
            backend: "modal",
          })
        }

        const resultKey = `${input.documentPath}/result.json`
        const { uploadUrl: resultUploadUrl } =
          yield* storage.getPresignedUploadUrl(resultKey)

        return yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${endpoint}/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                file_url: input.fileUrl,
                result_upload_url: resultUploadUrl,
                use_llm: input.useLlm,
                force_ocr: input.forceOcr ?? false,
                page_range: input.pageRange || null,
              }),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            })
            if (!res.ok)
              throw new Error(`[modal] Submit failed: ${await res.text()}`)
            const data = (await res.json()) as { id: string }
            return prefixJobId(data.id, workerType)
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

    supportsStreaming: () => false,
    getStreamUrl: () => null,
    supportsCancellation: () => false,
    cancelJob: () => Effect.succeed(false),
  }
}
