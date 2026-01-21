import { Hono } from "hono"
import type { BackendType, OutputFormat, ProcessingMode, ConversionInput } from "../types"
import type { Storage } from "../storage/types"
import { getDocumentPath } from "../storage/types"
import { jobFileMap } from "../storage/job-file-map"
import { createBackend } from "../backends/factory"
import { getAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { env } from "../env"

type Variables = {
  storage: Storage
}

export const convert = new Hono<{ Variables: Variables }>()

convert.post("/convert/:fileId", async (c) => {
  const event = c.get("event")
  const fileId = c.req.param("fileId")
  const query = c.req.query()
  const backendType = env.BACKEND_MODE
  const filename = query.filename
  if (!filename) {
    return c.json({ error: "Missing filename parameter" }, { status: 400 })
  }

  // Get optional auth to reconstruct document path
  const auth = await getAuth(c)
  const docPath = getDocumentPath(fileId, auth?.userId)
  const originalFilePath = `${docPath}/original.pdf`

  event.fileId = fileId
  event.backend = backendType as BackendType
  event.filename = filename
  event.outputFormat = (query.output_format as OutputFormat) || "html"
  event.processingMode = (query.mode as ProcessingMode) || "fast"
  event.useLlm = query.use_llm === "true"

  const backendResult = await tryCatch(async () => createBackend())
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
    outputFormat: (query.output_format as OutputFormat) || "html",
    processingMode: (query.mode as ProcessingMode) || "fast",
    useLlm: query.use_llm === "true",
    pageRange: query.page_range || "",
  }

  let input: ConversionInput
  const storage = c.get("storage")

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
  } else if (backendType === "local" || backendType === "runpod") {
    // Use internal URL for worker access (Docker network)
    const fileUrlResult = await tryCatch(storage.getFileUrl(originalFilePath, true))
    if (!fileUrlResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(fileUrlResult.error),
        code: "FILE_URL_ERROR",
      }
      return c.json({ error: "Failed to get file URL" }, { status: 500 })
    }
    input = { ...baseInput, fileUrl: fileUrlResult.data }
  } else {
    event.error = {
      category: "validation",
      message: `Unknown backend: ${backendType}`,
      code: "UNKNOWN_BACKEND",
    }
    return c.json({ error: `Unknown backend: ${backendType}` }, { status: 400 })
  }

  // Free TTS VRAM before conversion (local mode only)
  if (backendType === "local") {
    await fetch(`${env.TTS_WORKER_URL}/unload`, { method: "POST" }).catch(() => {})
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

  // Track job-file association for results saving and cleanup
  jobFileMap.set(jobResult.data, docPath, fileId, filename, backendType as BackendType)

  return c.json({ job_id: jobResult.data })
})

// Warm models (passthrough for local only)
convert.post("/warm-models", async (c) => {
  const event = c.get("event")
  const backendType = env.BACKEND_MODE
  event.backend = backendType as BackendType

  if (backendType !== "local") {
    return c.json({
      status: "skipped",
      reason: "Not applicable for cloud backends",
    })
  }

  const warmResult = await tryCatch(
    fetch(`${env.LOCAL_WORKER_URL}/warm-models`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    }),
  )
  if (!warmResult.success) {
    const isTimeout =
      warmResult.error instanceof Error &&
      (warmResult.error.name === "TimeoutError" ||
        warmResult.error.name === "AbortError")
    event.error = {
      category: isTimeout ? "timeout" : "network",
      message: getErrorMessage(warmResult.error),
      code: isTimeout ? "WARM_MODELS_TIMEOUT" : "WARM_MODELS_ERROR",
    }
    return c.json({ status: "error" })
  }

  if (!warmResult.data.ok) {
    event.error = {
      category: "backend",
      message: `Worker returned ${warmResult.data.status}`,
      code: "WARM_MODELS_FAILED",
    }
    return c.json({ status: "error" })
  }

  return c.json({ status: "ok" })
})
