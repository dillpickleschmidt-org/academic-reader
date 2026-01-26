import type { ConversionBackend } from "./interface"
import type { ConversionInput, ConversionJob } from "../types"
import { parseJobId, prefixJobId } from "./job-id"
import { mapLocalResponse, type LocalWorkerResponse } from "./response-mapper"

const TIMEOUT_MS = 30_000

// Docker service URLs (hardcoded - local mode always uses docker-compose)
const MARKER_URL = "http://marker:8000"
const LIGHTONOCR_URL = "http://lightonocr:8001"

/**
 * Local backend - passes through to FastAPI workers running in Docker.
 * Routes to Marker (fast mode) or LightOnOCR (accurate mode) based on processingMode.
 */
export class LocalBackend implements ConversionBackend {
  readonly name = "local"

  /**
   * Get base URL and raw job ID from a prefixed job ID.
   */
  private getWorkerUrl(jobId: string): { baseUrl: string; rawJobId: string } {
    const { worker, rawId } = parseJobId(jobId)
    const baseUrl = worker === "lightonocr" ? LIGHTONOCR_URL : MARKER_URL
    return { baseUrl, rawJobId: rawId }
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const useLightOnOCR = input.processingMode === "accurate"

    if (useLightOnOCR) {
      // LightOnOCR: simple API with file_url and page_range
      const params = new URLSearchParams()
      if (input.fileUrl) {
        params.set("file_url", input.fileUrl)
      }
      if (input.pageRange) {
        params.set("page_range", input.pageRange)
      }

      const response = await fetch(`${LIGHTONOCR_URL}/convert?${params}`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`[local] LightOnOCR submit failed: ${error}`)
      }

      const data = (await response.json()) as { job_id: string }
      return prefixJobId(data.job_id, "lightonocr")
    } else {
      // Marker: existing API with file_id path param
      const params = new URLSearchParams({
        use_llm: String(input.useLlm),
      })

      if (input.pageRange) {
        params.set("page_range", input.pageRange)
      }

      if (input.fileUrl) {
        params.set("file_url", input.fileUrl)
      }

      const response = await fetch(
        `${MARKER_URL}/convert/${input.fileId}?${params}`,
        { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) },
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`[local] Marker submit failed: ${error}`)
      }

      const data = (await response.json()) as { job_id: string }
      return prefixJobId(data.job_id, "marker")
    }
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const { baseUrl, rawJobId } = this.getWorkerUrl(jobId)
    const response = await fetch(`${baseUrl}/jobs/${rawJobId}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`[local] Failed to get job status (${response.status}): ${body}`)
    }

    const data = (await response.json()) as LocalWorkerResponse
    return mapLocalResponse(data)
  }

  supportsStreaming(): boolean {
    return true
  }

  getStreamUrl(jobId: string): string {
    const { baseUrl, rawJobId } = this.getWorkerUrl(jobId)
    // Note: LightOnOCR doesn't support streaming, but this returns the URL anyway
    // The frontend should check for stream availability
    return `${baseUrl}/jobs/${rawJobId}/stream`
  }

  supportsCancellation(): boolean {
    return true
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const { baseUrl, rawJobId } = this.getWorkerUrl(jobId)
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
 * Create Local backend.
 */
export function createLocalBackend(): LocalBackend {
  return new LocalBackend()
}
