/**
 * Routes for viewing and deleting saved/persisted documents.
 */
import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { requireAuth } from "../middleware/auth"
import type { Storage } from "../storage/types"
import { loadPersistedDocument, getStoragePaths } from "../services/document-persistence"
import { createAuthenticatedConvexClient } from "../services/convex"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { enhanceHtmlForReader } from "../utils/html-processing"

type Variables = {
  storage: Storage
  userId: string
}

export const savedDocuments = new Hono<{ Variables: Variables }>()

/**
 * Get HTML content for a saved document.
 * Returns the enhanced HTML ready for display in ResultPage.
 */
savedDocuments.get("/saved-documents/:documentId", requireAuth, async (c) => {
  const event = c.get("event")
  event.backend = (process.env.BACKEND_MODE || "local") as "local" | "runpod" | "datalab"
  const documentId = c.req.param("documentId")
  const userId = c.get("userId")
  const storage = c.get("storage")
  event.documentId = documentId

  const loadResult = await tryCatch(loadPersistedDocument(storage, userId, documentId))

  if (!loadResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(loadResult.error),
      code: "DOCUMENT_LOAD_ERROR",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  const { html, markdown } = loadResult.data

  // Enhance HTML for reader display (same as live conversion)
  const enhancedHtml = enhanceHtmlForReader(html)

  return c.json({
    html: enhancedHtml,
    markdown,
  })
})

/**
 * Delete a saved document and its storage files.
 */
savedDocuments.delete("/saved-documents/:documentId", requireAuth, async (c) => {
  const event = c.get("event")
  event.backend = (process.env.BACKEND_MODE || "local") as "local" | "runpod" | "datalab"
  const documentId = c.req.param("documentId")
  const userId = c.get("userId")
  const storage = c.get("storage")
  event.documentId = documentId

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = { category: "auth", message: "Failed to authenticate with Convex", code: "CONVEX_AUTH_ERROR" }
    return c.json({ error: "Authentication failed" }, 401)
  }

  // Delete from Convex (handles auth + chunks)
  const typedDocumentId = documentId as Id<"documents">
  const removeResult = await tryCatch(
    convex.mutation(api.api.documents.remove, { documentId: typedDocumentId }),
  )

  if (!removeResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(removeResult.error),
      code: "DOCUMENT_DELETE_ERROR",
    }
    return c.json({ error: "Failed to delete document" }, 500)
  }

  // Delete storage files (best-effort, don't fail if files missing)
  const paths = getStoragePaths(userId, documentId)
  await Promise.all([
    storage.deleteFile(paths.original).catch(() => {}),
    storage.deleteFile(paths.html).catch(() => {}),
    storage.deleteFile(paths.markdown).catch(() => {}),
  ])

  return c.json({ success: true })
})
