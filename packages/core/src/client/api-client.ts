import type {
  OutputFormat,
  ConversionProgress,
  ChunkBlock,
  ChunkOutput,
} from "../types/api"

export type { OutputFormat, ConversionProgress, ChunkBlock, ChunkOutput }

export interface UploadResponse {
  file_id: string
  filename: string
  size: number
}

export interface ConversionOptions {
  outputFormat: OutputFormat
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
}

export interface JobStatus {
  job_id: string
  status: "pending" | "processing" | "html_ready" | "completed" | "failed"
  result?: {
    content: string
    metadata: Record<string, unknown>
    jobId?: string // For persisting the result later
    fileId?: string
    formats?: {
      html: string
      markdown: string
      json: unknown
      chunks?: ChunkOutput
    }
    images?: Record<string, string> // filename -> public URL
  }
  error?: string
  progress?: ConversionProgress
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Upload failed")
  }

  return res.json()
}

export async function fetchFromUrl(url: string): Promise<UploadResponse> {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`, {
    method: "POST",
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Failed to fetch URL")
  }

  return res.json()
}

export async function startConversion(
  fileId: string,
  filename: string,
  options: ConversionOptions,
): Promise<{ job_id: string }> {
  const params = new URLSearchParams({
    output_format: options.outputFormat,
    use_llm: String(options.useLlm),
    force_ocr: String(options.forceOcr),
    filename,
  })
  if (options.pageRange.trim()) {
    params.set("page_range", options.pageRange.trim())
  }

  const res = await fetch(`/api/convert/${fileId}?${params}`, {
    method: "POST",
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Failed to start conversion")
  }

  return res.json()
}

export async function warmModels(): Promise<void> {
  fetch("/api/warm-models", { method: "POST" }).catch(() => {})
}

export async function cancelJob(jobId: string): Promise<{ status: string }> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Failed to cancel job")
  }

  return res.json()
}

/**
 * Persist a conversion result to permanent storage.
 * Call this after conversion completes if the user is authenticated.
 */
export async function persistDocument(
  jobId: string,
): Promise<{ documentId: string }> {
  const res = await fetch("/api/documents/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ jobId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "Failed to persist document")
  }

  return res.json()
}

export function subscribeToJob(
  jobId: string,
  onProgress: (progress: ConversionProgress) => void,
  onHtmlReady: (content: string) => void,
  onComplete: (result: NonNullable<JobStatus["result"]>) => void,
  onError: (error: string) => void,
): () => void {
  const eventSource = new EventSource(`/api/jobs/${jobId}/stream`)

  eventSource.addEventListener("progress", (e: MessageEvent) => {
    const progress = JSON.parse(e.data)
    onProgress(progress)
  })

  eventSource.addEventListener("html_ready", (e: MessageEvent) => {
    const data = JSON.parse(e.data)
    onHtmlReady(data.content)
  })

  eventSource.addEventListener("completed", (e: MessageEvent) => {
    const result = JSON.parse(e.data)
    onComplete(result)
    eventSource.close()
  })

  eventSource.addEventListener("failed", (e: MessageEvent) => {
    onError(e.data)
    eventSource.close()
  })

  eventSource.addEventListener("error", () => {
    onError("Stream error")
    eventSource.close()
  })

  eventSource.onerror = () => {
    onError("Connection failed")
    eventSource.close()
  }

  return () => eventSource.close()
}
