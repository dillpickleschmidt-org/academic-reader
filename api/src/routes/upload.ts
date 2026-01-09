import { Hono } from "hono"
import type { BackendType } from "../types"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { S3Storage, TempStorage } from "../storage"
import { tryCatch, getErrorMessage } from "../utils/try-catch"

// Worker upload response type and validator
type WorkerUploadResponse = { file_id: string; filename: string; size: number }

function isWorkerUploadResponse(v: unknown): v is WorkerUploadResponse {
  return (
    typeof v === "object" && v !== null &&
    "file_id" in v && typeof v.file_id === "string" &&
    "filename" in v && typeof v.filename === "string" &&
    "size" in v && typeof v.size === "number"
  )
}

// Extended context with storage adapters
type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

export const upload = new Hono<{ Variables: Variables }>()

// Upload file directly
upload.post("/upload", async (c) => {
  const event = c.get("event")
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  // Local mode: passthrough to FastAPI worker
  if (backend === "local") {
    const localUrl = process.env.LOCAL_WORKER_URL || "http://localhost:8000"

    const formDataResult = await tryCatch(c.req.formData())
    if (!formDataResult.success) {
      event.error = { category: "validation", message: getErrorMessage(formDataResult.error), code: "FORM_PARSE_ERROR" }
      return c.json({ error: "Invalid form data" }, { status: 400 })
    }

    const responseResult = await tryCatch(
      fetch(`${localUrl}/upload`, { method: "POST", body: formDataResult.data })
    )
    if (!responseResult.success) {
      event.error = { category: "network", message: getErrorMessage(responseResult.error), code: "LOCAL_WORKER_ERROR" }
      return c.json({ error: "Failed to connect to worker" }, { status: 502 })
    }
    const response = responseResult.data

    if (!response.ok) {
      const errorText = await response.text()
      event.error = { category: "backend", message: errorText, code: "LOCAL_WORKER_REJECTED" }
      return c.json({ error: errorText }, response.status as ContentfulStatusCode)
    }

    const result: unknown = await response.json()
    if (!isWorkerUploadResponse(result)) {
      event.error = { category: "backend", message: "Invalid response from worker", code: "INVALID_WORKER_RESPONSE" }
      return c.json({ error: "Invalid response from worker" }, { status: 502 })
    }
    event.fileId = result.file_id
    event.filename = result.filename
    event.fileSize = result.size
    return c.json(result)
  }

  // Datalab mode: store in temp storage for later direct upload
  if (backend === "datalab") {
    const tempStorage = c.get("tempStorage")
    if (!tempStorage) {
      event.error = { category: "storage", message: "Temp storage not configured", code: "TEMP_STORAGE_MISSING" }
      return c.json({ error: "Temp storage not configured" }, { status: 500 })
    }

    const formDataResult = await tryCatch(c.req.formData())
    if (!formDataResult.success) {
      event.error = { category: "validation", message: getErrorMessage(formDataResult.error), code: "FORM_PARSE_ERROR" }
      return c.json({ error: "Invalid form data" }, { status: 400 })
    }

    const file = formDataResult.data.get("file") as File | null
    if (!file || typeof file === "string") {
      event.error = { category: "validation", message: "No file provided", code: "MISSING_FILE" }
      return c.json({ error: "No file provided" }, { status: 400 })
    }

    event.filename = file.name
    event.contentType = file.type

    const arrayBufferResult = await tryCatch(file.arrayBuffer())
    if (!arrayBufferResult.success) {
      event.error = { category: "validation", message: getErrorMessage(arrayBufferResult.error), code: "FILE_READ_ERROR" }
      return c.json({ error: "Failed to read file" }, { status: 500 })
    }

    event.fileSize = arrayBufferResult.data.byteLength
    const fileId = crypto.randomUUID()
    event.fileId = fileId

    const storeResult = await tryCatch(
      tempStorage.store(fileId, {
        data: arrayBufferResult.data,
        filename: file.name,
        contentType: file.type || "application/pdf",
        expiresAt: Date.now() + 5 * 60 * 1000,
      })
    )
    if (!storeResult.success) {
      event.error = { category: "storage", message: getErrorMessage(storeResult.error), code: "TEMP_STORE_ERROR" }
      return c.json({ error: "Upload failed" }, { status: 500 })
    }

    return c.json({
      file_id: fileId,
      filename: file.name,
      size: arrayBufferResult.data.byteLength,
    })
  }

  // Runpod mode: upload to S3 storage
  if (backend === "runpod") {
    const storage = c.get("storage")
    if (!storage) {
      event.error = { category: "storage", message: "S3 storage not configured", code: "S3_STORAGE_MISSING" }
      return c.json({ error: "S3 storage not configured" }, { status: 500 })
    }

    const formDataResult = await tryCatch(c.req.formData())
    if (!formDataResult.success) {
      event.error = { category: "validation", message: getErrorMessage(formDataResult.error), code: "FORM_PARSE_ERROR" }
      return c.json({ error: "Invalid form data" }, { status: 400 })
    }

    const file = formDataResult.data.get("file") as File | null
    if (!file || typeof file === "string") {
      event.error = { category: "validation", message: "No file provided", code: "MISSING_FILE" }
      return c.json({ error: "No file provided" }, { status: 400 })
    }

    event.filename = file.name
    event.contentType = file.type

    const arrayBufferResult = await tryCatch(file.arrayBuffer())
    if (!arrayBufferResult.success) {
      event.error = { category: "validation", message: getErrorMessage(arrayBufferResult.error), code: "FILE_READ_ERROR" }
      return c.json({ error: "Failed to read file" }, { status: 500 })
    }

    event.fileSize = arrayBufferResult.data.byteLength

    const uploadResult = await tryCatch(
      storage.uploadFile(arrayBufferResult.data, file.name, file.type || "application/pdf")
    )
    if (!uploadResult.success) {
      event.error = { category: "storage", message: getErrorMessage(uploadResult.error), code: "S3_UPLOAD_ERROR" }
      return c.json({ error: "Upload failed" }, { status: 500 })
    }

    event.fileId = uploadResult.data.fileId
    return c.json({
      file_id: uploadResult.data.fileId,
      filename: uploadResult.data.filename,
      size: uploadResult.data.size,
    })
  }

  event.error = { category: "validation", message: `Unknown backend: ${backend}`, code: "UNKNOWN_BACKEND" }
  return c.json({ error: `Unknown backend: ${backend}` }, { status: 400 })
})

// Get presigned upload URL (Runpod mode only)
upload.post("/upload-url", async (c) => {
  const event = c.get("event")
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  if (backend !== "runpod") {
    event.error = { category: "validation", message: "Presigned URLs only available for Runpod mode", code: "WRONG_BACKEND" }
    return c.json({ error: "Presigned URLs only available for Runpod mode" }, { status: 400 })
  }

  const storage = c.get("storage")
  if (!storage) {
    event.error = { category: "storage", message: "S3 storage not configured", code: "S3_STORAGE_MISSING" }
    return c.json({ error: "S3 storage not configured" }, { status: 500 })
  }

  const bodyResult = await tryCatch(c.req.json<{ filename: string }>())
  if (!bodyResult.success) {
    event.error = { category: "validation", message: getErrorMessage(bodyResult.error), code: "JSON_PARSE_ERROR" }
    return c.json({ error: "Invalid request body" }, { status: 400 })
  }

  event.filename = bodyResult.data.filename

  const urlResult = await tryCatch(storage.getPresignedUploadUrl(bodyResult.data.filename))
  if (!urlResult.success) {
    event.error = { category: "storage", message: getErrorMessage(urlResult.error), code: "PRESIGN_URL_ERROR" }
    return c.json({ error: "Failed to generate upload URL" }, { status: 500 })
  }

  event.fileId = urlResult.data.fileId
  return c.json(urlResult.data)
})

// Fetch file from URL
upload.post("/fetch-url", async (c) => {
  const event = c.get("event")
  const url = c.req.query("url")

  if (!url) {
    event.error = { category: "validation", message: "Missing url parameter", code: "MISSING_URL" }
    return c.json({ error: "Missing url parameter" }, { status: 400 })
  }

  event.sourceUrl = url
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  // Local mode: passthrough to FastAPI worker
  if (backend === "local") {
    const localUrl = process.env.LOCAL_WORKER_URL || "http://localhost:8000"

    const responseResult = await tryCatch(
      fetch(`${localUrl}/fetch-url?url=${encodeURIComponent(url)}`, { method: "POST" })
    )
    if (!responseResult.success) {
      event.error = { category: "network", message: getErrorMessage(responseResult.error), code: "LOCAL_WORKER_ERROR" }
      return c.json({ error: "Failed to connect to worker" }, { status: 502 })
    }

    if (!responseResult.data.ok) {
      const errorText = await responseResult.data.text()
      event.error = { category: "backend", message: errorText, code: "LOCAL_WORKER_REJECTED" }
      return c.json({ error: errorText }, responseResult.data.status as ContentfulStatusCode)
    }

    const result: unknown = await responseResult.data.json()
    if (!isWorkerUploadResponse(result)) {
      event.error = { category: "backend", message: "Invalid response from worker", code: "INVALID_WORKER_RESPONSE" }
      return c.json({ error: "Invalid response from worker" }, { status: 502 })
    }
    event.fileId = result.file_id
    event.filename = result.filename
    event.fileSize = result.size
    return c.json(result)
  }

  // Fetch the file
  const fileResponseResult = await tryCatch(fetch(url))
  if (!fileResponseResult.success) {
    event.error = { category: "network", message: getErrorMessage(fileResponseResult.error), code: "URL_FETCH_ERROR" }
    return c.json({ error: "Failed to fetch URL" }, { status: 500 })
  }

  if (!fileResponseResult.data.ok) {
    event.error = { category: "network", message: `Failed to fetch URL: ${fileResponseResult.data.statusText}`, code: "URL_FETCH_FAILED" }
    return c.json({ error: `Failed to fetch URL: ${fileResponseResult.data.statusText}` }, { status: 400 })
  }

  const contentType = fileResponseResult.data.headers.get("content-type") || "application/pdf"
  const filename = url.split("/").pop()?.split("?")[0] || "document.pdf"

  const arrayBufferResult = await tryCatch(fileResponseResult.data.arrayBuffer())
  if (!arrayBufferResult.success) {
    event.error = { category: "network", message: getErrorMessage(arrayBufferResult.error), code: "URL_READ_ERROR" }
    return c.json({ error: "Failed to read fetched content" }, { status: 500 })
  }

  event.filename = filename
  event.contentType = contentType
  event.fileSize = arrayBufferResult.data.byteLength

  // Datalab mode: store in temp storage
  if (backend === "datalab") {
    const tempStorage = c.get("tempStorage")
    if (!tempStorage) {
      event.error = { category: "storage", message: "Temp storage not configured", code: "TEMP_STORAGE_MISSING" }
      return c.json({ error: "Temp storage not configured" }, { status: 500 })
    }

    const fileId = crypto.randomUUID()
    event.fileId = fileId

    const storeResult = await tryCatch(
      tempStorage.store(fileId, {
        data: arrayBufferResult.data,
        filename,
        contentType,
        expiresAt: Date.now() + 5 * 60 * 1000,
      })
    )
    if (!storeResult.success) {
      event.error = { category: "storage", message: getErrorMessage(storeResult.error), code: "TEMP_STORE_ERROR" }
      return c.json({ error: "Failed to store file" }, { status: 500 })
    }

    return c.json({
      file_id: fileId,
      filename,
      size: arrayBufferResult.data.byteLength,
    })
  }

  // Runpod mode: store in S3
  if (backend === "runpod") {
    const storage = c.get("storage")
    if (!storage) {
      event.error = { category: "storage", message: "S3 storage not configured", code: "S3_STORAGE_MISSING" }
      return c.json({ error: "S3 storage not configured" }, { status: 500 })
    }

    const uploadResult = await tryCatch(
      storage.uploadFile(arrayBufferResult.data, filename, contentType)
    )
    if (!uploadResult.success) {
      event.error = { category: "storage", message: getErrorMessage(uploadResult.error), code: "S3_UPLOAD_ERROR" }
      return c.json({ error: "Failed to store file" }, { status: 500 })
    }

    event.fileId = uploadResult.data.fileId
    return c.json({
      file_id: uploadResult.data.fileId,
      filename: uploadResult.data.filename,
      size: uploadResult.data.size,
    })
  }

  event.error = { category: "validation", message: `Unknown backend: ${backend}`, code: "UNKNOWN_BACKEND" }
  return c.json({ error: `Unknown backend: ${backend}` }, { status: 400 })
})
