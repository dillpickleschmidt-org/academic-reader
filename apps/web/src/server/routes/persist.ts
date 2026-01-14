/**
 * Route for persisting conversion results.
 * Creates a Convex document record linking to files stored during upload.
 */
import { Hono } from "hono"
import { z } from "zod"
import { resultCache } from "../storage/result-cache"
import { requireAuth } from "../middleware/auth"
import { persistDocument } from "../services/document-persistence"
import { createAuthenticatedConvexClient } from "../services/convex"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"

const requestSchema = z.object({
  jobId: z.string(),
})

type Variables = {
  userId: string
}

export const persist = new Hono<{ Variables: Variables }>()

/**
 * Persist a conversion result to permanent storage.
 *
 * POST /api/documents/persist
 * Body: { jobId: string }
 * Returns: { documentId: string }
 */
persist.post("/documents/persist", requireAuth, async (c) => {
  const event = c.get("event")
  const startTime = performance.now()

  // Parse request body
  const bodyResult = await tryCatch(c.req.json())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "Invalid request body" }, 400)
  }

  const parseResult = requestSchema.safeParse(bodyResult.data)
  if (!parseResult.success) {
    event.error = {
      category: "validation",
      message: parseResult.error.message,
      code: "VALIDATION_ERROR",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "Invalid request format" }, 400)
  }

  const { jobId } = parseResult.data
  event.jobId = jobId

  // Get cached result
  const cachedResult = resultCache.get(jobId)
  if (!cachedResult) {
    event.error = {
      category: "validation",
      message: "Result not found or expired",
      code: "RESULT_NOT_FOUND",
    }
    emitStreamingEvent(event, { status: 404 })
    return c.json({ error: "Result not found or expired. Please convert again." }, 404)
  }

  // Create authenticated Convex client
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = { category: "auth", message: "Failed to authenticate with Convex", code: "CONVEX_AUTH_ERROR" }
    emitStreamingEvent(event, { status: 401 })
    return c.json({ error: "Authentication failed" }, 401)
  }

  // Create Convex record with chunks (files are at documents/{userId}/{fileId}/)
  const persistResult = await tryCatch(
    persistDocument(convex, {
      fileId: cachedResult.fileId,
      filename: cachedResult.filename,
      pageCount: cachedResult.metadata.pages,
      chunks: cachedResult.chunks,
    }),
  )

  if (!persistResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(persistResult.error),
      code: "PERSIST_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to persist document" }, 500)
  }

  const documentId = persistResult.data

  // Clear cache entry
  resultCache.delete(jobId)

  event.documentId = documentId
  emitStreamingEvent(event, {
    status: 200,
    durationMs: Math.round(performance.now() - startTime),
  })

  return c.json({ documentId })
})
