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
      yield* enrichEvent({ backend: config.conversionBackend })

      const request = yield* HttpServerRequest.HttpServerRequest
      const webRequest = yield* HttpServerRequest.toWeb(request)
      const formData = yield* Effect.tryPromise({
        try: () => webRequest.formData(),
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
)
