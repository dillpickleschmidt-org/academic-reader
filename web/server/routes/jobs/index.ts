/**
 * Job streaming and management routes.
 *
 * Routes:
 * - GET /jobs/:jobId/stream - Stream job progress and completion
 * - POST /jobs/:jobId/cancel - Cancel a running job
 */

import { Hono } from "hono"
import type { BackendType } from "../../types"
import type { Storage } from "../../storage/types"
import { createBackend } from "../../backends/factory"
import { LocalBackend } from "../../backends/local"
import { requireAuth } from "../../middleware/auth"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"
import { emitStreamingEvent } from "../../middleware/wide-event-middleware"
import { env } from "../../env"
import { handleStreamingJob } from "./stream-proxy"
import { handlePollingJob } from "./poll-emitter"
import { handleCleanup } from "./processing"

type Variables = {
  storage: Storage
  userId: string
}

export const jobs = new Hono<{ Variables: Variables }>()

// ─────────────────────────────────────────────────────────────
// GET /jobs/:jobId/stream - Stream job progress and completion
// ─────────────────────────────────────────────────────────────

jobs.get("/:jobId/stream", requireAuth, async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const backendType = env.BACKEND_MODE
  const storage = c.get("storage")
  const headers = c.req.raw.headers

  event.jobId = jobId
  event.backend = backendType as BackendType

  const backendResult = await tryCatch(async () => createBackend(storage))
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    emitStreamingEvent(event)
    return c.json({ error: "Failed to initialize backend" }, 500)
  }
  const backend = backendResult.data

  // For local backend, proxy SSE stream with HTML enhancement and image handling
  if (backend.supportsStreaming() && backend instanceof LocalBackend) {
    const streamUrl = backend.getStreamUrl!(jobId)
    return handleStreamingJob({
      jobId,
      streamUrl,
      storage,
      event,
      headers,
    })
  }

  // For cloud backends, poll and emit SSE events
  return handlePollingJob({
    jobId,
    backend,
    storage,
    event,
    signal: c.req.raw.signal,
    headers,
  })
})

// ─────────────────────────────────────────────────────────────
// POST /jobs/:jobId/cancel - Cancel a running job
// ─────────────────────────────────────────────────────────────

jobs.post("/:jobId/cancel", requireAuth, async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const backendType = env.BACKEND_MODE
  const storage = c.get("storage")

  event.jobId = jobId
  event.backend = backendType as BackendType

  const backendResult = await tryCatch(async () => createBackend(storage))
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    return c.json({ error: "Failed to initialize backend" }, 500)
  }
  const backend = backendResult.data

  if (!backend.supportsCancellation()) {
    return c.json({ error: "Backend does not support cancellation" }, 400)
  }

  const cancelResult = await tryCatch(backend.cancelJob!(jobId))
  if (!cancelResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(cancelResult.error),
      code: "CANCEL_ERROR",
    }
    return c.json({ error: "Failed to cancel job" }, 500)
  }

  // Cleanup S3 file
  handleCleanup(event, jobId, "cancelled")

  return c.json({ status: "cancelled", jobId })
})
