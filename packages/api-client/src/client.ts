import { HttpClient, HttpClientResponse, HttpBody } from "@effect/platform"
import { Effect, Schema } from "effect"
import { ApiError } from "./errors"
import type { ConversionProgress } from "./schemas/job"
import type { ChunkOutput, TocResult } from "./schemas/document"
import { UploadResponse, type ConversionOptions } from "./schemas/upload"

export type { ConversionOptions }

export interface JobCompletionResult {
  content: string
  metadata: Record<string, unknown>
  jobId?: string
  fileId?: string
  documentId?: string
  formats?: {
    html: string
    markdown: string
    json: unknown
    chunks?: ChunkOutput
  }
  images?: Record<string, string>
  toc?: TocResult
}

export const uploadFile = (file: File) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const formData = new FormData()
    formData.append("file", file)
    return yield* client.post("/api/upload", {
      body: HttpBody.formData(formData),
    }).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(UploadResponse)),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const fetchFromUrl = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post(`/api/fetch-url?url=${encodeURIComponent(url)}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(UploadResponse)),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const startConversion = (
  fileId: string,
  filename: string,
  mimeType: string,
  options: ConversionOptions,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const params = new URLSearchParams({
      mode: options.processingMode,
      use_llm: String(options.useLlm),
      filename,
      mime_type: mimeType,
    })
    if (options.pageRange.trim()) params.set("page_range", options.pageRange.trim())
    return yield* client.post(`/api/convert/${fileId}?${params}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ job_id: Schema.String }))),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const cancelJob = (jobId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post(`/api/jobs/${jobId}/cancel`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ status: Schema.String }))),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export function subscribeToJob(
  jobId: string,
  onProgress: (progress: ConversionProgress) => void,
  onHtmlReady: (content: string) => void,
  onComplete: (result: JobCompletionResult) => void,
  onError: (error: string) => void,
): () => void {
  const eventSource = new EventSource(`/api/jobs/${jobId}/stream`, {
    withCredentials: true,
  })

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

export const downloadFile = async (
  fileId: string,
  fileName: string,
): Promise<void> => {
  const baseName = fileName.replace(/\.[^/.]+$/, "")
  const url = `/api/files/${fileId}/download?title=${encodeURIComponent(baseName)}`

  if (import.meta.env.PROD) {
    window.location.href = url
    return
  }

  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    throw new Error("Download failed")
  }

  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)

  const a = document.createElement("a")
  a.href = blobUrl
  a.download = `${baseName}.html`
  a.click()

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}
