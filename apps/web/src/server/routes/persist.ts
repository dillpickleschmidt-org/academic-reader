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

  // Parse request body
  const bodyResult = await tryCatch(c.req.json())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const parseResult = requestSchema.safeParse(bodyResult.data)
  if (!parseResult.success) {
    event.error = {
      category: "validation",
      message: parseResult.error.message,
      code: "VALIDATION_ERROR",
    }
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
    return c.json({ error: "Result not found or expired. Please convert again." }, 404)
  }

  // Create authenticated Convex client
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = { category: "auth", message: "Failed to authenticate with Convex", code: "CONVEX_AUTH_ERROR" }
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
    const errorMsg = getErrorMessage(persistResult.error)
    event.error = {
      category: "storage",
      message: errorMsg,
      code: "PERSIST_ERROR",
    }
    return c.json({ error: "Failed to persist document" }, 500)
  }

  const documentId = persistResult.data

  // Clear cache entry
  resultCache.delete(jobId)

  event.documentId = documentId

  return c.json({ documentId })
})
