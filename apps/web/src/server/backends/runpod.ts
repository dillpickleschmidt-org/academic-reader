import type { ConversionBackend } from "./interface"
import type {
  ChunkOutput,
  ConversionInput,
  ConversionJob,
  JobStatus,
} from "../types"

const TIMEOUT_MS = 30_000

interface RunpodConfig {
  endpointId: string
  apiKey: string
}

/**
 * Runpod backend - self-hosted serverless GPU on Runpod.
 */
class RunpodBackend implements ConversionBackend {
  readonly name = "runpod"
  private config: RunpodConfig
  private baseUrl: string

  constructor(config: RunpodConfig) {
    this.config = config
    this.baseUrl = `https://api.runpod.ai/v2/${config.endpointId}`
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const inputPayload: Record<string, unknown> = {
      file_url: input.fileUrl,
      output_format: input.outputFormat,
      use_llm: input.useLlm,
      force_ocr: input.forceOcr,
      page_range: input.pageRange,
    }

    const body: Record<string, unknown> = { input: inputPayload }

    const response = await fetch(`${this.baseUrl}/run`, {
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
    return data.id
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
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

  private mapStatus(status: string): JobStatus {
    const STATUS_MAP: Record<string, JobStatus> = {
      IN_QUEUE: "pending",
      IN_PROGRESS: "processing",
      COMPLETED: "completed",
      FAILED: "failed",
    }
    return STATUS_MAP[status] ?? "failed"
  }

  supportsStreaming(): boolean {
    return false
  }

  supportsCancellation(): boolean {
    return true
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cancel/${jobId}`, {
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
}

/**
 * Create Runpod backend from environment.
 */
export function createRunpodBackend(env: {
  RUNPOD_MARKER_ENDPOINT_ID?: string
  RUNPOD_API_KEY?: string
}): RunpodBackend {
  if (!env.RUNPOD_MARKER_ENDPOINT_ID || !env.RUNPOD_API_KEY) {
    throw new Error(
      "Runpod backend requires RUNPOD_MARKER_ENDPOINT_ID and RUNPOD_API_KEY",
    )
  }

  return new RunpodBackend({
    endpointId: env.RUNPOD_MARKER_ENDPOINT_ID,
    apiKey: env.RUNPOD_API_KEY,
  })
}
