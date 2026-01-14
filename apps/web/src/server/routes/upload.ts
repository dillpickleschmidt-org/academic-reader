import { Hono } from "hono"
import type { BackendType } from "../types"
import type { Storage } from "../storage/types"
import { getDocumentPath } from "../storage/types"
import { S3Storage } from "../storage/s3"
import { getAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { sanitizeFilename } from "../utils/sanitize"

type Variables = {
  storage: Storage
}

export const upload = new Hono<{ Variables: Variables }>()

// Upload file directly - saves to S3/MinIO for all modes
upload.post("/upload", async (c) => {
  const event = c.get("event")
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  const storage = c.get("storage")

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

  const filename = sanitizeFilename(file.name)
  event.filename = filename
  event.contentType = file.type

  const arrayBufferResult = await tryCatch(file.arrayBuffer())
  if (!arrayBufferResult.success) {
    event.error = { category: "validation", message: getErrorMessage(arrayBufferResult.error), code: "FILE_READ_ERROR" }
    return c.json({ error: "Failed to read file" }, { status: 500 })
  }

  event.fileSize = arrayBufferResult.data.byteLength

  // Get optional auth for storage path
  const auth = await getAuth(c)
  const fileId = crypto.randomUUID()
  const docPath = getDocumentPath(fileId, auth?.userId)

  // Save original file to document path
  const saveResult = await tryCatch(
    storage.saveFile(`${docPath}/original.pdf`, Buffer.from(arrayBufferResult.data))
  )
  if (!saveResult.success) {
    event.error = { category: "storage", message: getErrorMessage(saveResult.error), code: "UPLOAD_ERROR" }
    return c.json({ error: "Upload failed" }, { status: 500 })
  }

  event.fileId = fileId
  return c.json({
    file_id: fileId,
    filename,
    size: arrayBufferResult.data.byteLength,
  })
})

// Get presigned upload URL (S3 only - production)
upload.post("/upload-url", async (c) => {
  const event = c.get("event")
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  const storage = c.get("storage")

  // Presigned URLs only work with S3Storage
  if (!(storage instanceof S3Storage)) {
    event.error = { category: "validation", message: "Presigned URLs require S3 storage", code: "WRONG_STORAGE" }
    return c.json({ error: "Presigned URLs require S3 storage" }, { status: 400 })
  }

  const bodyResult = await tryCatch(c.req.json<{ filename: string }>())
  if (!bodyResult.success) {
    event.error = { category: "validation", message: getErrorMessage(bodyResult.error), code: "JSON_PARSE_ERROR" }
    return c.json({ error: "Invalid request body" }, { status: 400 })
  }

  const filename = sanitizeFilename(bodyResult.data.filename)
  event.filename = filename

  // Get optional auth for storage path
  const auth = await getAuth(c)
  const fileId = crypto.randomUUID()
  const docPath = getDocumentPath(fileId, auth?.userId)
  const key = `${docPath}/original.pdf`

  const urlResult = await tryCatch(storage.getPresignedUploadUrl(key))
  if (!urlResult.success) {
    event.error = { category: "storage", message: getErrorMessage(urlResult.error), code: "PRESIGN_URL_ERROR" }
    return c.json({ error: "Failed to generate upload URL" }, { status: 500 })
  }

  event.fileId = fileId
  return c.json({
    uploadUrl: urlResult.data.uploadUrl,
    fileId,
    expiresAt: urlResult.data.expiresAt,
  })
})

/**
 * Validate URL for SSRF protection (defense-in-depth, complements iptables rules).
 * Returns error message if blocked, null if allowed.
 */
function validateExternalUrl(urlString: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return "Invalid URL"
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http/https URLs allowed"
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block obvious internal hostnames
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    return "URL not allowed"
  }

  // Block private/internal IP ranges
  // Note: This can be bypassed via DNS, iptables is the real protection
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number)
    if (
      a === 127 ||                          // 127.0.0.0/8 loopback
      a === 10 ||                            // 10.0.0.0/8 private
      (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12 private
      (a === 192 && b === 168) ||            // 192.168.0.0/16 private
      (a === 169 && b === 254) ||            // 169.254.0.0/16 link-local
      a === 0                                // 0.0.0.0/8
    ) {
      return "URL not allowed"
    }
  }

  // Block IPv6 private ranges (matches iptables rules in README)
  if (
    hostname === "[::1]" ||                   // ::1 loopback
    /^\[?fc/i.test(hostname) ||               // fc00::/7 unique local
    /^\[?fd/i.test(hostname) ||               // fd00::/8 unique local
    /^\[?fe80:/i.test(hostname)               // fe80::/10 link-local
  ) {
    return "URL not allowed"
  }

  return null
}

// Fetch file from URL - saves to S3/MinIO for all modes
upload.post("/fetch-url", async (c) => {
  const event = c.get("event")
  const url = c.req.query("url")

  if (!url) {
    event.error = { category: "validation", message: "Missing url parameter", code: "MISSING_URL" }
    return c.json({ error: "Missing url parameter" }, { status: 400 })
  }

  // Validate URL (defense-in-depth, iptables is primary protection)
  const urlError = validateExternalUrl(url)
  if (urlError) {
    event.error = { category: "validation", message: urlError, code: "BLOCKED_URL" }
    return c.json({ error: urlError }, { status: 400 })
  }

  event.sourceUrl = url
  const backend = process.env.BACKEND_MODE || "local"
  event.backend = backend as BackendType

  const storage = c.get("storage")

  // Fetch the file
  const fileResponseResult = await tryCatch(
    fetch(url, { signal: AbortSignal.timeout(30_000) })
  )
  if (!fileResponseResult.success) {
    event.error = { category: "network", message: getErrorMessage(fileResponseResult.error), code: "URL_FETCH_ERROR" }
    return c.json({ error: "Failed to fetch URL" }, { status: 500 })
  }

  if (!fileResponseResult.data.ok) {
    event.error = { category: "network", message: `Failed to fetch URL: ${fileResponseResult.data.statusText}`, code: "URL_FETCH_FAILED" }
    return c.json({ error: `Failed to fetch URL: ${fileResponseResult.data.statusText}` }, { status: 400 })
  }

  // Extract and sanitize filename from URL
  const rawFilename = url.split("/").pop()?.split("?")[0] || ""
  const filename = sanitizeFilename(rawFilename)

  const arrayBufferResult = await tryCatch(fileResponseResult.data.arrayBuffer())
  if (!arrayBufferResult.success) {
    event.error = { category: "network", message: getErrorMessage(arrayBufferResult.error), code: "URL_READ_ERROR" }
    return c.json({ error: "Failed to read fetched content" }, { status: 500 })
  }

  event.filename = filename
  event.contentType = fileResponseResult.data.headers.get("content-type") || "application/pdf"
  event.fileSize = arrayBufferResult.data.byteLength

  // Get optional auth for storage path
  const auth = await getAuth(c)
  const fileId = crypto.randomUUID()
  const docPath = getDocumentPath(fileId, auth?.userId)

  // Save original file to document path
  const saveResult = await tryCatch(
    storage.saveFile(`${docPath}/original.pdf`, Buffer.from(arrayBufferResult.data))
  )
  if (!saveResult.success) {
    event.error = { category: "storage", message: getErrorMessage(saveResult.error), code: "UPLOAD_ERROR" }
    return c.json({ error: "Failed to store file" }, { status: 500 })
  }

  event.fileId = fileId
  return c.json({
    file_id: fileId,
    filename,
    size: arrayBufferResult.data.byteLength,
  })
})
