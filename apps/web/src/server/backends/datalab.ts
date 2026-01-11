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
export class DatalabBackend implements ConversionBackend {
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

    const blob = new Blob([input.fileData], { type: "application/pdf" })
    formData.append("file", blob, input.filename || "document.pdf")

    // Request all output formats
    formData.append("output_format", "html,markdown,json,chunks")

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
    let htmlContent = data.html || ""

    // Embed base64 images into HTML as data URIs
    if (data.html && data.images) {
      // Datalab supports png, jpg, webp for input/output images
      const extToMime: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      }
      for (const [filename, base64] of Object.entries(data.images)) {
        const ext = filename.split(".").pop()?.toLowerCase() || ""
        const mimeType = extToMime[ext] || "image/jpeg"
        const dataUri = `data:${mimeType};base64,${base64}`
        htmlContent = htmlContent
          .replaceAll(`src="${filename}"`, `src="${dataUri}"`)
          .replaceAll(`src='${filename}'`, `src="${dataUri}"`)
      }
    }

    return {
      jobId: data.request_id,
      status: this.mapStatus(data.status, data.success),
      result:
        data.status === "complete" && data.success
          ? {
              content: htmlContent,
              metadata: {},
              formats: {
                html: htmlContent,
                markdown: data.markdown || "",
                json: data.json,
                chunks: data.chunks,
              },
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
