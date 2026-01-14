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
import {
  processHtml,
  removeImgDescriptions,
  wrapCitations,
  processParagraphs,
  convertMathToHtml,
} from "../utils/html-processing"
import { addPageAttributes } from "../utils/tts-attribution"

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

  // Get document from Convex to retrieve storageId
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = { category: "auth", message: "Failed to authenticate with Convex", code: "CONVEX_AUTH_ERROR" }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const typedDocumentId = documentId as Id<"documents">
  const docResult = await tryCatch(
    convex.query(api.api.documents.get, { documentId: typedDocumentId })
  )

  if (!docResult.success || !docResult.data) {
    event.error = {
      category: "storage",
      message: !docResult.success ? getErrorMessage(docResult.error) : "Document not found",
      code: "DOCUMENT_NOT_FOUND",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  // Use storageId for S3 path
  const storageId = docResult.data.storageId

  // Fetch HTML/markdown and chunks in parallel
  const [loadResult, chunksResult] = await Promise.all([
    tryCatch(loadPersistedDocument(storage, userId, storageId)),
    tryCatch(convex.query(api.api.documents.getChunks, { documentId: typedDocumentId })),
  ])

  if (!loadResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(loadResult.error),
      code: "DOCUMENT_LOAD_ERROR",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  const { html, markdown } = loadResult.data
  const chunks = chunksResult.success ? chunksResult.data : []

  // Process HTML with single parse: enhancements + page attribution
  const enhancedHtml = processHtml(html, [
    removeImgDescriptions,
    wrapCitations,
    processParagraphs,
    convertMathToHtml,
    ($) => addPageAttributes($, chunks),
  ])

  return c.json({
    html: enhancedHtml,
    markdown,
    storageId,
    chunks,
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

  // Get document to retrieve storageId for S3 deletion
  const typedDocumentId = documentId as Id<"documents">
  const docResult = await tryCatch(
    convex.query(api.api.documents.get, { documentId: typedDocumentId })
  )

  if (!docResult.success || !docResult.data) {
    event.error = {
      category: "storage",
      message: !docResult.success ? getErrorMessage(docResult.error) : "Document not found",
      code: "DOCUMENT_NOT_FOUND",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  const storageId = docResult.data.storageId

  // Delete from Convex (handles auth + chunks)
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
  const paths = getStoragePaths(userId, storageId)
  await Promise.all([
    storage.deleteFile(paths.original).catch(() => {}),
    storage.deleteFile(paths.html).catch(() => {}),
    storage.deleteFile(paths.markdown).catch(() => {}),
  ])

  return c.json({ success: true })
})
