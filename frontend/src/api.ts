const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"

export interface UploadResponse {
  file_id: string
  filename: string
  size: number
}

export interface ConversionOptions {
  outputFormat: "html" | "markdown" | "json"
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
  }
  error?: string
}

export interface ConversionProgress {
  stage: string
  current: number
  total: number
  elapsed: number
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch(`${API_URL}/upload`, {
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
  const res = await fetch(
    `${API_URL}/fetch-url?url=${encodeURIComponent(url)}`,
    {
      method: "POST",
    },
  )

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Failed to fetch URL")
  }

  return res.json()
}

export async function startConversion(
  fileId: string,
  options: ConversionOptions,
): Promise<{ job_id: string }> {
  const params = new URLSearchParams({
    output_format: options.outputFormat,
    use_llm: String(options.useLlm),
    force_ocr: String(options.forceOcr),
  })
  if (options.pageRange.trim()) {
    params.set("page_range", options.pageRange.trim())
  }

  const res = await fetch(`${API_URL}/convert/${fileId}?${params}`, {
    method: "POST",
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Failed to start conversion")
  }

  return res.json()
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_URL}/jobs/${jobId}`)

  if (!res.ok) {
    throw new Error("Failed to check job status")
  }

  return res.json()
}

export async function warmModels(): Promise<void> {
  // Fire-and-forget, don't await or check response
  fetch(`${API_URL}/warm-models`, { method: "POST" }).catch(() => {
    // Ignore errors - model warming is best-effort
  })
}

export function subscribeToJob(
  jobId: string,
  onProgress: (progress: ConversionProgress) => void,
  onHtmlReady: (content: string) => void,
  onComplete: (result: NonNullable<JobStatus["result"]>) => void,
  onError: (error: string) => void,
): () => void {
  const eventSource = new EventSource(`${API_URL}/jobs/${jobId}/stream`)

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

  eventSource.addEventListener("error", (e: MessageEvent) => {
    onError(e.data || "Stream error")
    eventSource.close()
  })

  eventSource.onerror = () => {
    // Connection error - caller should fall back to polling
    eventSource.close()
  }

  return () => eventSource.close()
}
