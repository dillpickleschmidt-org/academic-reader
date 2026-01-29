import { Hono } from "hono"
import type { BackendType, ProcessingMode, ConversionInput } from "../types"
import type { Storage } from "../storage/types"
import { jobFileMap } from "../storage/job-file-map"
import { createBackend } from "../backends/factory"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { env } from "../env"

type Variables = {
  storage: Storage
  userId: string
}

export const convert = new Hono<{ Variables: Variables }>()

/**
 * Migrate file from temp storage to user storage if needed.
 * Returns the final document path.
 */
async function migrateToUserStorage(
  storage: Storage,
  fileId: string,
  userId: string,
): Promise<string> {
  const userPath = `documents/${userId}/${fileId}`
  const tempPath = `temp_documents/${fileId}`

  // Check if already in user storage
  if (await storage.exists(`${userPath}/original.pdf`)) {
    return userPath
  }

  // Check temp storage and migrate
  if (await storage.exists(`${tempPath}/original.pdf`)) {
    await storage.copyPrefix(tempPath, userPath)
    await storage.deletePrefix(tempPath)
    return userPath
  }

  throw new Error("File not found in storage")
}

convert.post("/convert/:fileId", requireAuth, async (c) => {
  const event = c.get("event")
  const fileId = c.req.param("fileId")
  const query = c.req.query()
  const backendType = env.BACKEND_MODE
  const filename = query.filename
  const mimeType = query.mime_type
  if (!filename) {
    return c.json({ error: "Missing filename parameter" }, { status: 400 })
  }

  const storage = c.get("storage")
  const userId = c.get("userId")

  // Migrate file from temp storage to user storage if needed
  const migrateResult = await tryCatch(migrateToUserStorage(storage, fileId, userId))
  if (!migrateResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(migrateResult.error),
      code: "FILE_MIGRATE_ERROR",
    }
    return c.json({ error: "File not found" }, { status: 404 })
  }
  const docPath = migrateResult.data
  const originalFilePath = `${docPath}/original.pdf`

  event.fileId = fileId
  event.backend = backendType as BackendType
  event.filename = filename
  event.processingMode = (query.mode as ProcessingMode) || "fast"
  event.useLlm = query.use_llm === "true"

  const backendResult = await tryCatch(async () => createBackend(storage))
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    return c.json(
      { error: getErrorMessage(backendResult.error) },
      { status: 500 },
    )
  }
  const backend = backendResult.data

  const baseInput = {
    fileId,
    processingMode: (query.mode as ProcessingMode) || "fast",
    useLlm: query.use_llm === "true",
    pageRange: query.page_range || "",
  }

  let input: ConversionInput

  if (backendType === "datalab") {
    // Datalab is an external API that can't access MinIO, so send bytes directly
    const bytesResult = await tryCatch(storage.readFile(originalFilePath))
    if (!bytesResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(bytesResult.error),
        code: "FILE_READ_ERROR",
      }
      return c.json({ error: "Failed to retrieve file" }, { status: 500 })
    }
    input = { ...baseInput, fileData: bytesResult.data, filename }
  } else if (backendType === "local") {
    // Use internal URL for local Docker worker access
    const fileUrlResult = await tryCatch(storage.getFileUrl(originalFilePath, true))
    if (!fileUrlResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(fileUrlResult.error),
        code: "FILE_URL_ERROR",
      }
      return c.json({ error: "Failed to get file URL" }, { status: 500 })
    }
    input = { ...baseInput, fileUrl: fileUrlResult.data, mimeType, documentPath: docPath }
  } else if (backendType === "modal") {
    // Use external URL (tunnel) for Modal worker access
    const fileUrlResult = await tryCatch(storage.getFileUrl(originalFilePath, false))
    if (!fileUrlResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(fileUrlResult.error),
        code: "FILE_URL_ERROR",
      }
      return c.json({ error: "Failed to get file URL" }, { status: 500 })
    }
    input = { ...baseInput, fileUrl: fileUrlResult.data, mimeType, documentPath: docPath }
  } else {
    event.error = {
      category: "validation",
      message: `Unknown backend: ${backendType}`,
      code: "UNKNOWN_BACKEND",
    }
    return c.json({ error: `Unknown backend: ${backendType}` }, { status: 400 })
  }

  const jobResult = await tryCatch(backend.submitJob(input))
  if (!jobResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(jobResult.error),
      code: "JOB_SUBMIT_ERROR",
    }
    return c.json({ error: getErrorMessage(jobResult.error) }, { status: 500 })
  }

  event.jobId = jobResult.data

  // Track job-file association for results saving, cleanup, and worker activation
  // Only track worker for local mode (used by stream-proxy for model activation)
  const processingMode = (query.mode as ProcessingMode) || "fast"
  const worker = backendType === "local"
    ? (processingMode === "balanced" ? "lightonocr" : "marker")
    : undefined
  jobFileMap.set(jobResult.data, docPath, fileId, filename, backendType as BackendType, worker, userId)

  return c.json({ job_id: jobResult.data })
})
