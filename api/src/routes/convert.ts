import { Hono } from "hono"
import type { Env, OutputFormat, ConversionInput } from "../types"
import type { S3Storage, TempStorage } from "../storage"
import { createBackend } from "../backends/factory"

// Extended context with storage adapters
type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

export const convert = new Hono<{ Bindings: Env; Variables: Variables }>()

convert.post("/convert/:fileId", async (c) => {
  const fileId = c.req.param("fileId")
  const query = c.req.query()
  const backendType = c.env.BACKEND_MODE || "local"

  try {
    const backend = createBackend(c.env)
    let input: ConversionInput

    // Local mode: just pass fileId, worker has the file
    if (backendType === "local") {
      const localUrl = c.env.LOCAL_WORKER_URL || "http://localhost:8000"
      input = {
        fileId,
        fileUrl: `${localUrl}/files/${fileId}`,
        outputFormat: (query.output_format as OutputFormat) || "html",
        useLlm: query.use_llm === "true",
        forceOcr: query.force_ocr === "true",
        pageRange: query.page_range,
      }
    }
    // Datalab mode: get file from temp storage for direct upload
    else if (backendType === "datalab") {
      const tempStorage = c.get("tempStorage")
      if (!tempStorage) {
        return c.json({ error: "Temp storage not configured" }, { status: 500 })
      }

      const tempFile = await tempStorage.retrieve(fileId)
      if (!tempFile) {
        return c.json({ error: "File not found or expired" }, { status: 404 })
      }

      input = {
        fileId,
        fileData: tempFile.data,
        filename: tempFile.filename,
        outputFormat: (query.output_format as OutputFormat) || "html",
        useLlm: query.use_llm === "true",
        forceOcr: query.force_ocr === "true",
        pageRange: query.page_range,
      }

      // Clean up temp file after we have the data
      await tempStorage.delete(fileId)
    }
    // Runpod mode: get file URL from S3
    else if (backendType === "runpod") {
      const storage = c.get("storage")
      if (!storage) {
        return c.json({ error: "S3 storage not configured" }, { status: 500 })
      }

      const fileUrl = await storage.getFileUrl(fileId)
      input = {
        fileId,
        fileUrl,
        outputFormat: (query.output_format as OutputFormat) || "html",
        useLlm: query.use_llm === "true",
        forceOcr: query.force_ocr === "true",
        pageRange: query.page_range,
      }
    } else {
      return c.json(
        { error: `Unknown backend: ${backendType}` },
        { status: 400 },
      )
    }

    const jobId = await backend.submitJob(input)

    return c.json({ job_id: jobId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed"
    return c.json({ error: message }, { status: 500 })
  }
})

// Warm models (passthrough for local only)
convert.post("/warm-models", async (c) => {
  if (c.env.BACKEND_MODE !== "local") {
    return c.json({
      status: "skipped",
      reason: "Not applicable for cloud backends",
    })
  }

  const localUrl = c.env.LOCAL_WORKER_URL || "http://localhost:8000"
  try {
    await fetch(`${localUrl}/warm-models`, { method: "POST" })
    return c.json({ status: "ok" })
  } catch {
    return c.json({ status: "error" })
  }
})
