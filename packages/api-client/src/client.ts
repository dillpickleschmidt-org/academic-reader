import { HttpClient, HttpClientResponse, HttpBody } from "@effect/platform"
import { Effect, Option, Schema, Stream } from "effect"
import { Sse } from "@effect/experimental"
import { ApiError } from "./errors"
import type { ConversionProgress } from "./schemas/job"
import type { ChunkOutput, TocResult } from "./schemas/document"
import { SavedDocumentResponse } from "./schemas/document"
import { UploadResponse, type ConversionOptions } from "./schemas/upload"
import { VoicesResponse } from "./schemas/tts"

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
    return yield* client
      .post("/api/upload", {
        body: HttpBody.formData(formData),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(UploadResponse)),
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const fetchFromUrl = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post(`/api/fetch-url?url=${encodeURIComponent(url)}`)
      .pipe(
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
    if (options.pageRange.trim())
      params.set("page_range", options.pageRange.trim())
    return yield* client.post(`/api/convert/${fileId}?${params}`).pipe(
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(
          Schema.Struct({ job_id: Schema.String }),
        ),
      ),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const cancelJob = (jobId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post(`/api/jobs/${jobId}/cancel`).pipe(
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(
          Schema.Struct({ status: Schema.String }),
        ),
      ),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export type JobStreamEvent =
  | { readonly _tag: "Progress"; readonly progress: ConversionProgress }
  | { readonly _tag: "HtmlReady"; readonly content: string }
  | { readonly _tag: "Completed"; readonly result: JobCompletionResult }
  | { readonly _tag: "Failed"; readonly error: string }

export const subscribeToJobStream = (jobId: string) =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const response = yield* client
        .get(`/api/jobs/${jobId}/stream`)
        .pipe(
          Effect.mapError(
            (e) => new ApiError({ message: String(e), status: 0 }),
          ),
        )
      const decoder = new TextDecoder()
      return response.stream.pipe(
        Stream.map((bytes) => decoder.decode(bytes, { stream: true })),
        Stream.pipeThroughChannel(Sse.makeChannel()),
        Stream.filterMap((event): Option.Option<JobStreamEvent> => {
          switch (event.event) {
            case "progress":
              return Option.some({
                _tag: "Progress",
                progress: JSON.parse(event.data) as ConversionProgress,
              })
            case "html_ready":
              return Option.some({
                _tag: "HtmlReady",
                content: (JSON.parse(event.data) as { content: string })
                  .content,
              })
            case "completed":
              return Option.some({
                _tag: "Completed",
                result: JSON.parse(event.data) as JobCompletionResult,
              })
            case "failed":
              return Option.some({
                _tag: "Failed",
                error: event.data,
              })
            default:
              return Option.none()
          }
        }),
      )
    }),
  )

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

export const loadSavedDocument = (documentId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.get(`/api/saved-documents/${documentId}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(SavedDocumentResponse)),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const deleteSavedDocument = (
  documentId: string,
  threadAction?: string,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const params = threadAction ? `?threadAction=${threadAction}` : ""
    return yield* client
      .del(`/api/saved-documents/${documentId}${params}`)
      .pipe(
        Effect.asVoid,
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const prefetchTTS = (params: {
  documentId: string
  blockId: string
  ttsText: string
  voiceId: string
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post("/api/tts/prefetch", {
        body: HttpBody.unsafeJson(params),
      })
      .pipe(
        Effect.asVoid,
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const synthesizeTTS = (params: {
  documentId: string
  blockId: string
  ttsText?: string
  voiceId: string
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const body: Record<string, string> = {
      documentId: params.documentId,
      blockId: params.blockId,
      voiceId: params.voiceId,
    }
    if (params.ttsText) body.ttsText = params.ttsText
    const response = yield* client
      .post("/api/tts/synthesize", {
        body: HttpBody.unsafeJson(body),
      })
      .pipe(
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
    return response
  })

export const batchTTS = (params: {
  documentId: string
  voiceId: string
  blocks: Array<{ blockId: string; ttsText: string }>
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post("/api/tts/batch", {
        body: HttpBody.unsafeJson(params),
      })
      .pipe(
        Effect.asVoid,
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const unloadTTS = () =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post("/api/tts/unload").pipe(
      Effect.asVoid,
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const fetchVoices = () =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.get("/api/tts/voices").pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(VoicesResponse)),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const triggerEmbeddings = (documentId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post(`/api/documents/${documentId}/embeddings`).pipe(
      Effect.asVoid,
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const fetchPdfPage = (documentId: string, pageNum: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .get(`/api/saved-documents/${documentId}/page/${pageNum}`)
      .pipe(
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })
