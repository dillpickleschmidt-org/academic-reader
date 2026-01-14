// Re-export shared types from @repo/core
export type {
  BackendType,
  OutputFormat,
  JobStatus,
  ConversionInput,
  ConversionProgress,
  ChunkBlock,
  ChunkOutput,
  AllFormats,
  ConversionResult,
  ConversionJob,
  UploadResult,
  PresignedUrlResult,
} from "@repo/core/types/api"

import type { BackendType, OutputFormat } from "@repo/core/types/api"

// Server-only types

export type ErrorCategory =
  | "storage"
  | "backend"
  | "convex"
  | "auth"
  | "validation"
  | "network"
  | "internal"
  | "timeout"
  | "configuration"

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
  fileId?: string | null
  jobId?: string
  documentId?: string
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

  // Job cleanup (on cancel/failure/timeout/disconnect)
  cleanup?: {
    reason: "cancelled" | "failed" | "timeout" | "client_disconnect"
    cleaned: boolean
    documentPath?: string
  }

  // Extensible
  [key: string]: unknown
}

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

  // Convex HTTP actions URL (for auth proxy, port 3211)
  CONVEX_HTTP_URL?: string

  // Convex admin API URL (for mutations/queries/actions, port 3210)
  CONVEX_SITE_URL?: string
}
