// Re-export shared types from @repo/core
export type {
  BackendType,
  OutputFormat,
  ProcessingMode,
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

import type { BackendType, OutputFormat, ProcessingMode } from "@repo/core/types/api"

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
  processingMode?: ProcessingMode
  useLlm?: boolean

  // Error context
  error?: WideEventError

  // Warning context (non-critical issues)
  warning?: { message: string; code: string }

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
