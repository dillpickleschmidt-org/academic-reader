import { Hono } from "hono"
import type { BackendType, OutputFormat, ConversionInput } from "../types"
import type { S3Storage, TempStorage } from "../storage"
import { createBackend } from "../backends/factory"
import { tryCatch, getErrorMessage } from "../utils/try-catch"

// Extended context with storage adapters
type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

export const convert = new Hono<{ Variables: Variables }>()

convert.post("/convert/:fileId", async (c) => {
  const event = c.get("event")
  const fileId = c.req.param("fileId")
  const query = c.req.query()
  const backendType = process.env.BACKEND_MODE || "local"

  event.fileId = fileId
  event.backend = backendType as BackendType
  event.outputFormat = (query.output_format as OutputFormat) || "html"
  event.useLlm = query.use_llm === "true"
  event.forceOcr = query.force_ocr === "true"

  const backendResult = await tryCatch(async () => createBackend())
  if (!backendResult.success) {
    event.error = { category: "backend", message: getErrorMessage(backendResult.error), code: "BACKEND_INIT_ERROR" }
    return c.json({ error: getErrorMessage(backendResult.error) }, { status: 500 })
  }
  const backend = backendResult.data

  let input: ConversionInput

  // Local mode: just pass fileId, worker has the file
  if (backendType === "local") {
    const localUrl = process.env.LOCAL_WORKER_URL || "http://localhost:8000"
    input = {
      fileId,
      fileUrl: `${localUrl}/files/${fileId}`,
      outputFormat: (query.output_format as OutputFormat) || "html",
      useLlm: query.use_llm === "true",
      forceOcr: query.force_ocr === "true",
      pageRange: query.page_range || "",
    }
  }
  // Datalab mode: get file from temp storage for direct upload
  else if (backendType === "datalab") {
    const tempStorage = c.get("tempStorage")
    if (!tempStorage) {
      event.error = { category: "storage", message: "Temp storage not configured", code: "TEMP_STORAGE_MISSING" }
      return c.json({ error: "Temp storage not configured" }, { status: 500 })
    }

    const tempFileResult = await tryCatch(tempStorage.retrieve(fileId))
    if (!tempFileResult.success) {
      event.error = { category: "storage", message: getErrorMessage(tempFileResult.error), code: "TEMP_RETRIEVE_ERROR" }
      return c.json({ error: "Failed to retrieve file" }, { status: 500 })
    }
    if (!tempFileResult.data) {
      event.error = { category: "storage", message: "File not found or expired", code: "FILE_NOT_FOUND" }
      return c.json({ error: "File not found or expired" }, { status: 404 })
    }

    input = {
      fileId,
      fileData: tempFileResult.data.data,
      filename: tempFileResult.data.filename,
      outputFormat: (query.output_format as OutputFormat) || "html",
      useLlm: query.use_llm === "true",
      forceOcr: query.force_ocr === "true",
      pageRange: query.page_range || "",
    }

    // Clean up temp file after we have the data
    await tempStorage.delete(fileId)
  }
  // Runpod mode: get file URL from S3
  else if (backendType === "runpod") {
    const storage = c.get("storage")
    if (!storage) {
      event.error = { category: "storage", message: "S3 storage not configured", code: "S3_STORAGE_MISSING" }
      return c.json({ error: "S3 storage not configured" }, { status: 500 })
    }

    const fileUrlResult = await tryCatch(storage.getFileUrl(fileId))
    if (!fileUrlResult.success) {
      event.error = { category: "storage", message: getErrorMessage(fileUrlResult.error), code: "S3_URL_ERROR" }
      return c.json({ error: "Failed to get file URL" }, { status: 500 })
    }

    input = {
      fileId,
      fileUrl: fileUrlResult.data,
      outputFormat: (query.output_format as OutputFormat) || "html",
      useLlm: query.use_llm === "true",
      forceOcr: query.force_ocr === "true",
      pageRange: query.page_range || "",
    }
  } else {
    event.error = { category: "validation", message: `Unknown backend: ${backendType}`, code: "UNKNOWN_BACKEND" }
    return c.json({ error: `Unknown backend: ${backendType}` }, { status: 400 })
  }

  const jobResult = await tryCatch(backend.submitJob(input))
  if (!jobResult.success) {
    event.error = { category: "backend", message: getErrorMessage(jobResult.error), code: "JOB_SUBMIT_ERROR" }
    return c.json({ error: getErrorMessage(jobResult.error) }, { status: 500 })
  }

  event.jobId = jobResult.data
  return c.json({ job_id: jobResult.data })
})

// Warm models (passthrough for local only)
convert.post("/warm-models", async (c) => {
  const event = c.get("event")
  const backendType = process.env.BACKEND_MODE || "local"
  event.backend = backendType as BackendType

  if (backendType !== "local") {
    return c.json({
      status: "skipped",
      reason: "Not applicable for cloud backends",
    })
  }

  const localUrl = process.env.LOCAL_WORKER_URL || "http://localhost:8000"

  const warmResult = await tryCatch(
    fetch(`${localUrl}/warm-models`, { method: "POST" })
  )
  if (!warmResult.success) {
    event.error = { category: "network", message: getErrorMessage(warmResult.error), code: "WARM_MODELS_ERROR" }
    return c.json({ status: "error" })
  }

  if (!warmResult.data.ok) {
    event.error = { category: "backend", message: `Worker returned ${warmResult.data.status}`, code: "WARM_MODELS_FAILED" }
    return c.json({ status: "error" })
  }

  return c.json({ status: "ok" })
})
