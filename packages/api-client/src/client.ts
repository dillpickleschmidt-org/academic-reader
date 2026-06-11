import {
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http"
import { Effect } from "effect"
import {
  CreateDocumentResponse,
  LoadedDocument,
  type CreateDocumentRequest,
} from "./schemas/document"
import { UploadResponse, type ConversionOptions } from "./schemas/upload"
import {
  GenerateDocumentAudioResult,
  GetBlockAudioResponse,
  type GenerateDocumentAudioRequest,
  type GetBlockAudioRequest,
} from "./schemas/tts"

export type { ConversionOptions }

export class ApiError extends Error {
  readonly _tag = "ApiError"
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(UploadResponse)),
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

export const downloadFile = async (
  documentId: string,
  fileName: string,
  settings?: Record<string, string>,
): Promise<void> => {
  const baseName = fileName.replace(/\.[^/.]+$/, "")
  const params = new URLSearchParams({ title: baseName, ...settings })
  const url = `/api/documents/${documentId}/download?${params}`

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

export const createDocumentFromUpload = (params: CreateDocumentRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const body = yield* HttpBody.json(params)
    return yield* client
      .post("/api/documents", { body })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(CreateDocumentResponse),
        ),
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

export const loadDocumentContent = (documentId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.get(`/api/documents/${documentId}/content`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(LoadedDocument)),
      Effect.scoped,
    )
  }).pipe(Effect.mapError(toApiError))

export const deleteDocument = (
  documentId: string,
  threadAction: "keep" | "delete",
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .del(`/api/documents/${documentId}?threadAction=${threadAction}`)
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.asVoid,
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

export const generateDocumentAudio = (
  params: GenerateDocumentAudioRequest,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const body = yield* HttpBody.json(params)
    return yield* client
      .post("/api/tts/generate-document-audio", { body })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(GenerateDocumentAudioResult),
        ),
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

export const getBlockAudio = (params: GetBlockAudioRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const body = yield* HttpBody.json(params)
    return yield* client
      .post("/api/tts/get-block-audio", { body })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GetBlockAudioResponse)),
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

export const triggerEmbeddings = (documentId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.post(`/api/documents/${documentId}/embeddings`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.asVoid,
      Effect.scoped,
    )
  }).pipe(Effect.mapError(toApiError))

export const fetchPdfPage = (documentId: string, pageNum: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .get(`/api/documents/${documentId}/page/${pageNum}`)
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.scoped,
      )
  }).pipe(Effect.mapError(toApiError))

function toApiError(error: unknown) {
  return new ApiError(
    HttpClientError.isHttpClientError(error) ? (error.response?.status ?? 0) : 0,
    error instanceof Error ? error.message : String(error),
  )
}
