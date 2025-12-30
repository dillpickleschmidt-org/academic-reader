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
  status: "pending" | "processing" | "completed" | "failed"
  result?: {
    content: string
    metadata: Record<string, unknown>
  }
  error?: string
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
