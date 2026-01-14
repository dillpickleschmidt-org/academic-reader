import type { ConversionBackend } from "./interface"
import type {
  ChunkOutput,
  ConversionInput,
  ConversionJob,
  JobStatus,
} from "../types"

const TIMEOUT_MS = 300_000 // 5 minutes per request

interface DatalabConfig {
  apiKey: string
}

interface DatalabResponse {
  request_id: string
  status: string
  success?: boolean
  markdown?: string
  html?: string
  json?: unknown
  chunks?: ChunkOutput
  error?: string
  images?: Record<string, string>
}

/**
 * Datalab backend - hosted Marker API from Datalab.
 * API docs: https://www.datalab.to/docs/marker
 */
class DatalabBackend implements ConversionBackend {
  readonly name = "datalab"
  private config: DatalabConfig
  private readonly baseUrl = "https://www.datalab.to/api/v1/marker"

  constructor(config: DatalabConfig) {
    this.config = config
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const formData = new FormData()

    // Direct file upload - Datalab accepts file as multipart form data
    if (!input.fileData) {
      throw new Error("Datalab backend requires fileData for direct upload")
    }

    // Convert Buffer to Uint8Array if needed (Blob accepts Uint8Array but not Buffer)
    const fileBytes = Buffer.isBuffer(input.fileData)
      ? new Uint8Array(input.fileData)
      : input.fileData
    const blob = new Blob([fileBytes], { type: "application/pdf" })
    formData.append("file", blob, input.filename || "document.pdf")

    // Request all output formats
    formData.append("output_format", "html,markdown,json")

    // Mode: balanced (default) or accurate (with LLM/Gemini 2.0 Flash)
    formData.append("mode", input.useLlm ? "accurate" : "balanced")

    if (input.forceOcr) {
      formData.append("force_ocr", "true")
    }

    if (input.pageRange) {
      formData.append("page_range", input.pageRange)
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "X-API-Key": this.config.apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Datalab submission failed: ${error}`)
    }

    const data = (await response.json()) as {
      request_id: string
      status: string
    }
    return data.request_id
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/${jobId}`, {
      headers: {
        "X-API-Key": this.config.apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Failed to get job status (${response.status}): ${body}`)
    }

    const data = (await response.json()) as DatalabResponse
    return this.parseResponse(data)
  }

  private mapStatus(status: string, success?: boolean): JobStatus {
    if (status === "complete" && !success) return "failed"
    const STATUS_MAP: Record<string, JobStatus> = {
      pending: "pending",
      processing: "processing",
      complete: "completed",
      failed: "failed",
    }
    return STATUS_MAP[status] ?? "failed"
  }

  private parseResponse(data: DatalabResponse): ConversionJob {
    const rawHtml = data.html ?? ""

    return {
      jobId: data.request_id,
      status: this.mapStatus(data.status, data.success),
      // Raw HTML for early display (progressive loading with shimmer placeholders)
      htmlContent:
        data.status === "complete" && data.success ? rawHtml : undefined,
      result:
        data.status === "complete" && data.success
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

  supportsStreaming(): boolean {
    return false
  }

  supportsCancellation(): boolean {
    return false
  }
}

/**
 * Create Datalab backend from environment.
 */
export function createDatalabBackend(env: {
  DATALAB_API_KEY?: string
}): DatalabBackend {
  if (!env.DATALAB_API_KEY) {
    throw new Error("Datalab backend requires DATALAB_API_KEY")
  }

  return new DatalabBackend({
    apiKey: env.DATALAB_API_KEY,
  })
}
