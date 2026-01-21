import type { ConversionBackend } from "./interface"
import type {
  ChunkOutput,
  ConversionInput,
  ConversionJob,
  JobStatus,
} from "../types"

const TIMEOUT_MS = 30_000

interface RunpodConfig {
  markerEndpointId: string
  chandraEndpointId?: string
  apiKey: string
}

/**
 * Runpod backend - self-hosted serverless GPU on Runpod.
 */
class RunpodBackend implements ConversionBackend {
  readonly name = "runpod"
  private config: RunpodConfig
  private markerBaseUrl: string
  private chandraBaseUrl: string | null

  constructor(config: RunpodConfig) {
    this.config = config
    this.markerBaseUrl = `https://api.runpod.ai/v2/${config.markerEndpointId}`
    this.chandraBaseUrl = config.chandraEndpointId
      ? `https://api.runpod.ai/v2/${config.chandraEndpointId}`
      : null
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const useChandra = input.processingMode === "accurate"

    // Validate Chandra endpoint if needed
    if (useChandra && !this.chandraBaseUrl) {
      throw new Error(
        "Accurate mode requires RUNPOD_CHANDRA_ENDPOINT_ID to be configured",
      )
    }

    // Build payload based on endpoint
    const inputPayload: Record<string, unknown> = useChandra
      ? {
          file_url: input.fileUrl,
          page_range: input.pageRange || undefined,
        }
      : {
          file_url: input.fileUrl,
          output_format: input.outputFormat,
          use_llm: input.useLlm,
          page_range: input.pageRange,
        }

    const body: Record<string, unknown> = { input: inputPayload }
    const baseUrl = useChandra ? this.chandraBaseUrl! : this.markerBaseUrl

    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `Runpod submission failed (${response.status}): ${error}`,
      )
    }

    const data = (await response.json()) as { id?: string }
    if (typeof data.id !== "string" || data.id.trim() === "") {
      throw new Error(
        `Runpod returned invalid job ID (${response.status}): ${JSON.stringify(data)}`,
      )
    }

    // Prefix job ID to track which endpoint it belongs to
    return useChandra ? `chandra:${data.id}` : `marker:${data.id}`
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const { baseUrl, rawJobId } = this.parseJobId(jobId)
    const response = await fetch(`${baseUrl}/status/${rawJobId}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Failed to get job status (${response.status}): ${body}`)
    }

    const data = (await response.json()) as {
      id: string
      status: string
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

    const isComplete = data.status === "COMPLETED"
    const output = data.output

    return {
      jobId: data.id,
      status: this.mapStatus(data.status),
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

  supportsStreaming(): boolean {
    return false
  }

  supportsCancellation(): boolean {
    return true
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const { baseUrl, rawJobId } = this.parseJobId(jobId)
    try {
      const response = await fetch(`${baseUrl}/cancel/${rawJobId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return response.ok
    } catch (error) {
      console.warn(`[Runpod] Failed to cancel job ${jobId}:`, error)
      return false
    }
  }

  // Private helpers

  /**
   * Parse prefixed job ID to get base URL and raw job ID.
   * Format: "chandra:abc123" or "marker:abc123" or just "abc123" (legacy)
   */
  private parseJobId(jobId: string): { baseUrl: string; rawJobId: string } {
    if (jobId.startsWith("chandra:")) {
      if (!this.chandraBaseUrl) {
        throw new Error("Chandra endpoint not configured but job ID indicates Chandra")
      }
      return { baseUrl: this.chandraBaseUrl, rawJobId: jobId.slice(8) }
    }
    if (jobId.startsWith("marker:")) {
      return { baseUrl: this.markerBaseUrl, rawJobId: jobId.slice(7) }
    }
    // Legacy: no prefix, assume Marker
    return { baseUrl: this.markerBaseUrl, rawJobId: jobId }
  }

  private mapStatus(status: string): JobStatus {
    const STATUS_MAP: Record<string, JobStatus> = {
      IN_QUEUE: "pending",
      IN_PROGRESS: "processing",
      COMPLETED: "completed",
      FAILED: "failed",
    }
    return STATUS_MAP[status] ?? "failed"
  }
}

/**
 * Create Runpod backend from environment.
 */
export function createRunpodBackend(env: {
  RUNPOD_MARKER_ENDPOINT_ID?: string
  RUNPOD_CHANDRA_ENDPOINT_ID?: string
  RUNPOD_API_KEY?: string
}): RunpodBackend {
  if (!env.RUNPOD_MARKER_ENDPOINT_ID || !env.RUNPOD_API_KEY) {
    throw new Error(
      "Runpod backend requires RUNPOD_MARKER_ENDPOINT_ID and RUNPOD_API_KEY",
    )
  }

  return new RunpodBackend({
    markerEndpointId: env.RUNPOD_MARKER_ENDPOINT_ID,
    chandraEndpointId: env.RUNPOD_CHANDRA_ENDPOINT_ID,
    apiKey: env.RUNPOD_API_KEY,
  })
}
