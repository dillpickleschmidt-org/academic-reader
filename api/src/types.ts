// Shared type definitions

export type BackendType = "local" | "runpod" | "datalab"
export type OutputFormat = "html" | "markdown" | "json"
export type JobStatus =
  | "pending"
  | "processing"
  | "html_ready"
  | "completed"
  | "failed"

export interface ConversionInput {
  fileId: string
  fileUrl?: string // For Runpod/local (S3 URL)
  fileData?: ArrayBuffer // For Datalab (direct upload)
  filename?: string // For Datalab (original filename)
  outputFormat: OutputFormat
  useLlm: boolean
  forceOcr: boolean
  pageRange: string // Empty string = all pages
}

export interface ConversionProgress {
  stage: string
  current: number
  total: number
  elapsed: number
}

// Chunk output from Marker's ChunkRenderer
export interface ChunkBlock {
  id: string
  block_type: string
  html: string
  page: number
  polygon: number[][]
  bbox: number[]
  section_hierarchy?: Record<string, string>
  images?: Record<string, string>
}

export interface ChunkOutput {
  blocks: ChunkBlock[]
  page_info: Record<string, { bbox: number[]; polygon: number[][] }>
  metadata: Record<string, unknown>
}

export interface AllFormats {
  html: string
  markdown: string
  json: unknown
  chunks?: ChunkOutput
}

export interface ConversionResult {
  content: string
  metadata: Record<string, unknown>
  formats?: AllFormats
}

export interface ConversionJob {
  jobId: string
  status: JobStatus
  result?: ConversionResult
  htmlContent?: string
  error?: string
  progress?: ConversionProgress
}

export interface UploadResult {
  fileId: string
  filename: string
  size: number
}

export interface PresignedUrlResult {
  uploadUrl: string
  fileId: string
  expiresAt: string
}

// Wide event for structured logging
export type ErrorCategory =
  | "storage"
  | "backend"
  | "auth"
  | "validation"
  | "network"
  | "internal"

export interface WideEventError {
  category: ErrorCategory
  message: string
  code?: string
}

export interface WideEvent {
  // Core (set by middleware)
  requestId: string
  timestamp: string
  service: string
  version: string
  environment: BackendType
  deployment: "dev" | "prod"
  method: string
  path: string
  status?: number
  durationMs?: number

  // Business context (set by handlers)
  fileId?: string
  jobId?: string
  backend?: BackendType
  filename?: string
  fileSize?: number
  contentType?: string
  outputFormat?: OutputFormat
  useLlm?: boolean
  forceOcr?: boolean

  // Error context
  error?: WideEventError

  // SSE streaming
  isStreaming?: boolean
  streamEvents?: number

  // Extensible
  [key: string]: unknown
}

// Environment bindings
export interface Env {
  // Backend selection
  BACKEND_MODE: BackendType

  // Local backend
  LOCAL_WORKER_URL?: string

  // Runpod backend
  RUNPOD_ENDPOINT_ID?: string
  RUNPOD_API_KEY?: string

  // Datalab backend
  DATALAB_API_KEY?: string

  // Google AI (Gemini)
  GOOGLE_API_KEY?: string

  // S3-compatible storage (for Runpod mode)
  S3_ENDPOINT?: string
  S3_ACCESS_KEY?: string
  S3_SECRET_KEY?: string
  S3_BUCKET?: string

  // Frontend URL (used for CORS)
  SITE_URL?: string

  // Convex HTTP actions URL (for auth proxy)
  CONVEX_HTTP_URL?: string
}
