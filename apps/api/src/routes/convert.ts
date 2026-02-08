import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import { ValidationError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"
import { Storage } from "../services/storage"
import { ConversionBackend } from "../services/backends/conversion"
import { JobFileMap, getWorkerFromProcessingMode } from "../services/job-file-map"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"

function migrateToUserStorage(
  storage: { exists: (k: string) => Effect.Effect<boolean, any>, copyPrefix: (s: string, d: string) => Effect.Effect<number, any>, deletePrefix: (p: string) => Effect.Effect<number, any> },
  fileId: string,
  userId: string,
) {
  return Effect.gen(function* () {
    const userPath = `documents/${userId}/${fileId}`
    const tempPath = `temp_documents/${fileId}`

    if (yield* storage.exists(`${userPath}/original.pdf`)) return userPath
    if (yield* storage.exists(`${tempPath}/original.pdf`)) {
      yield* storage.copyPrefix(tempPath, userPath)
      yield* storage.deletePrefix(tempPath)
      return userPath
    }

    return yield* new ValidationError({ message: "File not found in storage" })
  })
}

export const convertRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/:fileId",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      const backend = yield* ConversionBackend
      const jobFileMap = yield* JobFileMap
      const { userId } = yield* requireAuth

      const params = yield* HttpRouter.params
      const fileId = params.fileId!

      const request = yield* HttpServerRequest.HttpServerRequest
      const urlObj = new URL(request.url, "http://localhost")
      const query = Object.fromEntries(urlObj.searchParams.entries())

      const filename = query.filename
      const mimeType = query.mime_type
      if (!filename) {
        return yield* new ValidationError({ message: "Missing filename parameter" })
      }

      const processingMode = (query.mode as ProcessingMode) || "fast"
      const useLlm = query.use_llm === "true"
      const pageRange = query.page_range || ""

      yield* enrichEvent({
        fileId,
        backend: config.backendMode,
        filename,
        processingMode,
        useLlm,
      })

      const docPath = yield* migrateToUserStorage(storage, fileId, userId)
      const originalFilePath = `${docPath}/original.pdf`

      const baseInput = { fileId, processingMode, useLlm, pageRange }

      let input: Parameters<typeof backend.submitJob>[0]

      if (config.backendMode === "datalab") {
        const fileData = yield* storage.readFile(originalFilePath)
        input = { ...baseInput, fileData, filename }
      } else if (config.backendMode === "local") {
        const fileUrl = yield* storage.getFileUrl(originalFilePath, true)
        input = { ...baseInput, fileUrl, mimeType, documentPath: docPath }
      } else {
        const fileUrl = yield* storage.getFileUrl(originalFilePath, false)
        input = { ...baseInput, fileUrl, mimeType, documentPath: docPath }
      }

      const jobId = yield* backend.submitJob(input)

      yield* enrichEvent({ jobId })

      const workerType = config.backendMode === "local"
        ? getWorkerFromProcessingMode(processingMode)
        : "marker" as const
      yield* jobFileMap.set(jobId, {
        fileId,
        userId,
        documentPath: docPath,
        workerType,
        filename,
        mimeType,
        processingMode,
      })

      return HttpServerResponse.unsafeJson({ job_id: jobId })
    }),
  ),
)
