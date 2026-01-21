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
}

/**
 * Local backend - passes through to FastAPI worker running locally.
 * Used for development when running docker compose.
 */
export class LocalBackend implements ConversionBackend {
  readonly name = "local"
  private baseUrl: string

  constructor(config: LocalConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
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

  async submitJob(input: ConversionInput): Promise<string> {
    // processingMode ignored for now (placeholder for Chandra)
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
      `${this.baseUrl}/convert/${input.fileId}?${params}`,
      { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Local backend error: ${error}`)
    }

    const data = (await response.json()) as { job_id: string }
    return data.job_id
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
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
    return `${this.baseUrl}/jobs/${jobId}/stream`
  }

  supportsCancellation(): boolean {
    return true
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cancel/${jobId}`, {
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
}): LocalBackend {
  return new LocalBackend({
    baseUrl: env.LOCAL_WORKER_URL || "http://localhost:8000",
  })
}
