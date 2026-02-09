import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import * as mupdf from "mupdf"
import { ValidationError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"
import { Storage, getDocumentPath } from "../services/storage"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"
import { sanitizeFilename } from "../utils/sanitize"
import { validateExternalUrl } from "../utils/url-validation"

function getOptionalAuth() {
  return requireAuth.pipe(Effect.catchAll(() => Effect.succeed(null)))
}

function extractPageCount(
  data: ArrayBuffer,
  contentType: string,
): number | undefined {
  if (contentType !== "application/pdf") return undefined
  try {
    const doc = mupdf.Document.openDocument(
      Buffer.from(data),
      "application/pdf",
    )
    const count = doc.countPages()
    doc.destroy()
    return count
  } catch {
    return undefined
  }
}

export const uploadRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      yield* enrichEvent({ backend: config.backendMode })

      const request = yield* HttpServerRequest.HttpServerRequest
      const formData = yield* Effect.tryPromise({
        try: () => {
          const webReq = new Request(request.url, {
            method: request.method,
            headers: request.headers as Record<string, string>,
            body: (request as any).source?.body ?? null,
          })
          return webReq.formData()
        },
        catch: () => new ValidationError({ message: "Invalid form data" }),
      })

      const file = formData.get("file") as File | null
      if (!file || typeof file === "string") {
        return yield* new ValidationError({ message: "No file provided" })
      }

      const filename = sanitizeFilename(file.name)
      yield* enrichEvent({ filename, contentType: file.type })

      const arrayBuffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: () => new ValidationError({ message: "Failed to read file" }),
      })
      yield* enrichEvent({ fileSize: arrayBuffer.byteLength })

      const auth = yield* getOptionalAuth()
      const fileId = crypto.randomUUID()
      const docPath = getDocumentPath(fileId, auth?.userId)

      yield* storage.saveFile(
        `${docPath}/original.pdf`,
        Buffer.from(arrayBuffer),
      )

      const pageCount = extractPageCount(arrayBuffer, file.type)

      yield* enrichEvent({ fileId })
      return HttpServerResponse.unsafeJson({
        file_id: fileId,
        filename,
        size: arrayBuffer.byteLength,
        content_type: file.type,
        page_count: pageCount,
      })
    }),
  ),

  HttpRouter.post(
    "/upload-url",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      yield* enrichEvent({ backend: config.backendMode })

      const request = yield* HttpServerRequest.HttpServerRequest
      const body = (yield* request.json) as { filename: string }

      const { filename: rawFilename } = body as { filename: string }
      if (!rawFilename) {
        return yield* new ValidationError({ message: "Missing filename" })
      }

      const filename = sanitizeFilename(rawFilename)
      yield* enrichEvent({ filename })

      const auth = yield* getOptionalAuth()
      const fileId = crypto.randomUUID()
      const docPath = getDocumentPath(fileId, auth?.userId)
      const key = `${docPath}/original.pdf`

      const { uploadUrl, expiresAt } = yield* storage.getPresignedUploadUrl(key)

      yield* enrichEvent({ fileId })
      return HttpServerResponse.unsafeJson({ uploadUrl, fileId, expiresAt })
    }),
  ),

  HttpRouter.post(
    "/fetch-url",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      const request = yield* HttpServerRequest.HttpServerRequest

      const urlObj = new URL(request.url, "http://localhost")
      const url = urlObj.searchParams.get("url")

      if (!url) {
        return yield* new ValidationError({ message: "Missing url parameter" })
      }

      const urlError = validateExternalUrl(url)
      if (urlError) {
        return yield* new ValidationError({ message: urlError })
      }

      yield* enrichEvent({ backend: config.backendMode })

      const fileResponse = yield* Effect.tryPromise({
        try: () => fetch(url, { signal: AbortSignal.timeout(30_000) }),
        catch: () => new ValidationError({ message: "Failed to fetch URL" }),
      })

      if (!fileResponse.ok) {
        return yield* new ValidationError({
          message: `Failed to fetch URL: ${fileResponse.statusText}`,
        })
      }

      const rawFilename = url.split("/").pop()?.split("?")[0] || ""
      const filename = sanitizeFilename(rawFilename)
      const contentType =
        fileResponse.headers.get("content-type") || "application/pdf"

      const arrayBuffer = yield* Effect.tryPromise({
        try: () => fileResponse.arrayBuffer(),
        catch: () =>
          new ValidationError({ message: "Failed to read fetched content" }),
      })

      yield* enrichEvent({
        filename,
        contentType,
        fileSize: arrayBuffer.byteLength,
      })

      const auth = yield* getOptionalAuth()
      const fileId = crypto.randomUUID()
      const docPath = getDocumentPath(fileId, auth?.userId)

      yield* storage.saveFile(
        `${docPath}/original.pdf`,
        Buffer.from(arrayBuffer),
      )

      const pageCount = extractPageCount(arrayBuffer, contentType)

      yield* enrichEvent({ fileId })
      return HttpServerResponse.unsafeJson({
        file_id: fileId,
        filename,
        size: arrayBuffer.byteLength,
        content_type: contentType,
        page_count: pageCount,
      })
    }),
  ),
)
