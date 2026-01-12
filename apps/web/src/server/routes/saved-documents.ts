/**
 * Routes for viewing saved/persisted documents.
 */
import { Hono } from "hono"
import { requireAuth } from "../middleware/auth"
import type { PersistentStorage } from "../storage"
import { loadPersistedDocument } from "../services/document-persistence"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { enhanceHtmlForReader } from "../utils/html-processing"

type Variables = {
  persistentStorage: PersistentStorage | null
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
  event.documentId = documentId

  const persistentStorage = c.get("persistentStorage")

  if (!persistentStorage) {
    event.error = {
      category: "configuration",
      message: "Persistent storage not available",
      code: "STORAGE_NOT_CONFIGURED",
    }
    return c.json({ error: "Persistent storage not available" }, 503)
  }

  const loadResult = await tryCatch(loadPersistedDocument(persistentStorage, userId, documentId))

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
