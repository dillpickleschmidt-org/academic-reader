import type { ConversionBackend } from "./interface"
import type {
  ChunkOutput,
  ConversionInput,
  ConversionJob,
  JobStatus,
} from "../types"

const TIMEOUT_MS = 30_000

interface LocalConfig {
  baseUrl: string
  lightonocrUrl?: string
}

/**
 * Local backend - passes through to FastAPI workers running locally.
 * Routes to Marker (fast mode) or LightOnOCR (accurate mode) based on processingMode.
 */
export class LocalBackend implements ConversionBackend {
  readonly name = "local"
  private markerUrl: string
  private lightonocrUrl: string | null

  constructor(config: LocalConfig) {
    this.markerUrl = config.baseUrl.replace(/\/+$/, "")
    this.lightonocrUrl = config.lightonocrUrl?.replace(/\/+$/, "") ?? null
  }

  private mapStatus(status: string): JobStatus {
    const STATUS_MAP: Record<string, JobStatus> = {
      pending: "pending",
      processing: "processing",
      html_ready: "html_ready",
      completed: "completed",
      failed: "failed",
      cancelled: "failed",
    }
    return STATUS_MAP[status] ?? "failed"
  }

  /**
   * Parse prefixed job ID to get base URL and raw job ID.
   * Format: "lightonocr:abc123" or "marker:abc123" or just "abc123" (legacy)
   */
  private parseJobId(jobId: string): { baseUrl: string; rawJobId: string } {
    if (jobId.startsWith("lightonocr:")) {
      if (!this.lightonocrUrl) {
        throw new Error(
          "LightOnOCR worker not configured but job ID indicates LightOnOCR",
        )
      }
      return { baseUrl: this.lightonocrUrl, rawJobId: jobId.slice(11) }
    }
    if (jobId.startsWith("marker:")) {
      return { baseUrl: this.markerUrl, rawJobId: jobId.slice(7) }
    }
    // Legacy: no prefix, assume Marker
    return { baseUrl: this.markerUrl, rawJobId: jobId }
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const useLightOnOCR = input.processingMode === "accurate"

    // Validate LightOnOCR endpoint if needed
    if (useLightOnOCR && !this.lightonocrUrl) {
      throw new Error(
        "Accurate mode requires LIGHTONOCR_WORKER_URL to be configured",
      )
    }

    if (useLightOnOCR) {
      // LightOnOCR: simple API with file_url and page_range
      const params = new URLSearchParams()
      if (input.fileUrl) {
        params.set("file_url", input.fileUrl)
      }
      if (input.pageRange) {
        params.set("page_range", input.pageRange)
      }

      const response = await fetch(`${this.lightonocrUrl}/convert?${params}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`LightOnOCR backend error: ${error}`)
      }

      const data = (await response.json()) as { job_id: string }
      return `lightonocr:${data.job_id}`
    } else {
      // Marker: existing API with file_id path param
      const params = new URLSearchParams({
        output_format: input.outputFormat,
        use_llm: String(input.useLlm),
      })

      if (input.pageRange) {
        params.set("page_range", input.pageRange)
      }

      if (input.fileUrl) {
        params.set("file_url", input.fileUrl)
      }

      const response = await fetch(
        `${this.markerUrl}/convert/${input.fileId}?${params}`,
        { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) },
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Local backend error: ${error}`)
      }

      const data = (await response.json()) as { job_id: string }
      return `marker:${data.job_id}`
    }
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const { baseUrl, rawJobId } = this.parseJobId(jobId)
    const response = await fetch(`${baseUrl}/jobs/${rawJobId}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Failed to get job status (${response.status}): ${body}`)
    }

    const data = (await response.json()) as {
      job_id: string
      status: string
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

    const status = this.mapStatus(data.status)
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
      progress: data.progress
        ? { ...data.progress, elapsed: data.progress.elapsed ?? 0 }
        : undefined,
    }
  }

  supportsStreaming(): boolean {
    return true
  }

  getStreamUrl(jobId: string): string {
    const { baseUrl, rawJobId } = this.parseJobId(jobId)
    // Note: LightOnOCR doesn't support streaming, but this returns the URL anyway
    // The frontend should check for stream availability
    return `${baseUrl}/jobs/${rawJobId}/stream`
  }

  supportsCancellation(): boolean {
    return true
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const { baseUrl, rawJobId } = this.parseJobId(jobId)
    try {
      const response = await fetch(`${baseUrl}/cancel/${rawJobId}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return response.ok
    } catch (error) {
      console.warn(`[Local] Failed to cancel job ${jobId}:`, error)
      return false
    }
  }
}

/**
 * Create Local backend from environment.
 */
export function createLocalBackend(env: {
  LOCAL_WORKER_URL?: string
  LIGHTONOCR_WORKER_URL?: string
}): LocalBackend {
  return new LocalBackend({
    baseUrl: env.LOCAL_WORKER_URL || "http://localhost:8000",
    lightonocrUrl: env.LIGHTONOCR_WORKER_URL,
  })
}
