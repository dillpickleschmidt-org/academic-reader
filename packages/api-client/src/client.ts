import { HttpClient, HttpClientResponse, HttpBody } from "@effect/platform"
import { Effect } from "effect"
import { ApiError } from "./errors"
import { CreateDocumentResponse, LoadedDocument } from "./schemas/document"
import { UploadResponse, type ConversionOptions } from "./schemas/upload"
import {
  GenerateDocumentAudioResult,
  GetBlockAudioResponse,
} from "./schemas/tts"

export type { ConversionOptions }

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

export const createDocumentFromUpload = (params: {
  fileId: string
  filename: string
  mimeType: string
  sizeBytes: number
  pageCount: number | null
  processingMode: ConversionOptions["processingMode"]
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  audioVoiceId: string
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post("/api/documents", {
        body: HttpBody.unsafeJson(params),
      })
      .pipe(
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(CreateDocumentResponse),
        ),
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const loadDocumentContent = (documentId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client.get(`/api/documents/${documentId}/content`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(LoadedDocument)),
      Effect.scoped,
      Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
    )
  })

export const deleteDocument = (
  documentId: string,
  threadAction: "keep" | "delete",
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .del(`/api/documents/${documentId}?threadAction=${threadAction}`)
      .pipe(
        Effect.asVoid,
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const generateDocumentAudio = (params: {
  documentId: string
  voiceId: string
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post("/api/tts/generate-document-audio", {
        body: HttpBody.unsafeJson(params),
      })
      .pipe(
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(GenerateDocumentAudioResult),
        ),
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })

export const getBlockAudio = (params: {
  documentId: string
  blockId: string
  voiceId: string
}) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* client
      .post("/api/tts/get-block-audio", {
        body: HttpBody.unsafeJson(params),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GetBlockAudioResponse)),
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
      .get(`/api/documents/${documentId}/page/${pageNum}`)
      .pipe(
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.scoped,
        Effect.mapError((e) => new ApiError({ message: String(e), status: 0 })),
      )
  })
