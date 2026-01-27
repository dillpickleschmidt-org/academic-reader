/**
 * Unified response mapping for all conversion backends.
 *
 * Each backend returns different response shapes - this module normalizes them
 * to a consistent ConversionJob format.
 */

import type { ChunkOutput, ConversionJob, JobStatus } from "../types"

// ============================================================================
// Raw response types from each backend
// ============================================================================

/**
 * Raw response from Local workers (Marker and CHANDRA).
 */
export interface LocalWorkerResponse {
  job_id: string
  status: "pending" | "processing" | "html_ready" | "completed" | "failed" | "cancelled"
  result?: {
    content: string
    metadata: Record<string, unknown>
    formats?: {
      html: string
      markdown: string
      json: unknown
      chunks?: ChunkOutput
    }
    images?: Record<string, string>
  }
  html_content?: string
  error?: string
  progress?: {
    stage: string
    current: number
    total: number
    elapsed?: number
  }
}

/**
 * Raw response from Runpod serverless endpoints.
 */
export interface RunpodResponse {
  id: string
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
  output?: {
    content: string
    metadata: Record<string, unknown>
    formats?: {
      html: string
      markdown: string
      json: unknown
      chunks?: ChunkOutput
    }
    images?: Record<string, string>
  }
  error?: string
}

/**
 * Raw response from Datalab hosted API.
 */
export interface DatalabResponse {
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

// ============================================================================
// Status mappings
// ============================================================================

const LOCAL_STATUS_MAP: Record<string, JobStatus> = {
  pending: "pending",
  processing: "processing",
  html_ready: "html_ready",
  completed: "completed",
  failed: "failed",
  cancelled: "failed",
}

const RUNPOD_STATUS_MAP: Record<string, JobStatus> = {
  IN_QUEUE: "pending",
  IN_PROGRESS: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
}

const DATALAB_STATUS_MAP: Record<string, JobStatus> = {
  pending: "pending",
  processing: "processing",
  complete: "completed",
  failed: "failed",
}

// ============================================================================
// Mapper functions
// ============================================================================

/**
 * Map a Local worker response to ConversionJob.
 */
export function mapLocalResponse(data: LocalWorkerResponse): ConversionJob {
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
                  json: result.formats.json,
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

/**
 * Map a Runpod response to ConversionJob.
 */
export function mapRunpodResponse(data: RunpodResponse): ConversionJob {
  const status = RUNPOD_STATUS_MAP[data.status] ?? "failed"
  const isComplete = status === "completed"
  const output = data.output

  return {
    jobId: data.id,
    status,
    htmlContent: isComplete ? output?.formats?.html : undefined,
    result:
      isComplete && output
        ? {
            content: output.content,
            metadata: output.metadata,
            formats: output.formats
              ? {
                  html: output.formats.html,
                  markdown: output.formats.markdown,
                  json: output.formats.json,
                  chunks: output.formats.chunks,
                }
              : undefined,
            images: output.images,
          }
        : undefined,
    error: data.error,
  }
}

/**
 * Map a Datalab response to ConversionJob.
 */
export function mapDatalabResponse(data: DatalabResponse): ConversionJob {
  // Datalab uses success=false for failures even when status is "complete"
  const rawStatus = data.status === "complete" && !data.success ? "failed" : data.status
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
            json: data.json,
            chunks: data.chunks,
          },
          images: data.images,
        }
      : undefined,
    error: data.error,
  }
}
