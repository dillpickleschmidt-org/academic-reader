import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { Effect } from "effect"
import * as mupdf from "mupdf"
import { ValidationError } from "@academic-reader/api-client/errors"
import { Storage } from "../services/storage"
import { tempOriginalFileKey } from "../documents/document-storage"
import { sanitizeFilename } from "../utils/sanitize"

function extractPageCount(
  data: ArrayBuffer,
  contentType: string,
): number | null {
  if (contentType !== "application/pdf") return null
  try {
    const doc = mupdf.Document.openDocument(
      Buffer.from(data),
      "application/pdf",
    )
    const count = doc.countPages()
    doc.destroy()
    return count
  } catch {
    return null
  }
}

export const uploadRouter = HttpRouter.add(
  "POST",
  "/api/upload",
  Effect.gen(function* () {
    const storage = yield* Storage

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

    const arrayBuffer = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: () => new ValidationError({ message: "Failed to read file" }),
    })

    const fileId = crypto.randomUUID()
    yield* storage.saveFile(
      tempOriginalFileKey(fileId),
      Buffer.from(arrayBuffer),
    )

    const pageCount = extractPageCount(arrayBuffer, file.type)

    return HttpServerResponse.jsonUnsafe({
      file_id: fileId,
      filename,
      size: arrayBuffer.byteLength,
      content_type: file.type,
      page_count: pageCount,
    })
  }),
)
