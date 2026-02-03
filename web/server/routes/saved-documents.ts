/**
 * Routes for viewing and deleting saved/persisted documents.
 */
import { Hono } from "hono"
import * as mupdf from "mupdf"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { requireAuth } from "../middleware/auth"
import type { Storage } from "../storage/types"
import { loadPersistedDocument } from "../services/document-persistence"
import { createAuthenticatedConvexClient } from "../services/convex"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"
import { env } from "../env"

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
  event.backend = env.BACKEND_MODE as
    | "local"
    | "datalab"
    | "modal"
  const documentId = c.req.param("documentId")
  const userId = c.get("userId")
  const storage = c.get("storage")
  event.documentId = documentId

  // Get document from Convex to retrieve storageId
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const typedDocumentId = documentId as Id<"documents">
  const docResult = await tryCatch(
    convex.query(api.api.documents.get, { documentId: typedDocumentId }),
  )

  if (!docResult.success || !docResult.data) {
    event.error = {
      category: "storage",
      message: !docResult.success
        ? getErrorMessage(docResult.error)
        : "Document not found",
      code: "DOCUMENT_NOT_FOUND",
    }
    return c.json({ error: "Document not found" }, 404)
  }

  // Use storageId for S3 path
  const storageId = docResult.data.storageId
  const toc = docResult.data.toc

  // Fetch HTML/markdown and chunks in parallel
  const [loadResult, chunksResult] = await Promise.all([
    tryCatch(loadPersistedDocument(storage, userId, storageId)),
    tryCatch(
      convex.query(api.api.documents.getChunks, {
        documentId: typedDocumentId,
      }),
    ),
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

  // Process HTML with single parse (block IDs already added by Marker)
  const enhancedHtml = processHtml(html, HTML_TRANSFORMS)

  return c.json({
    html: enhancedHtml,
    markdown,
    storageId,
    chunks,
    toc,
    documentId,
  })
})

/**
 * Delete a saved document and its storage files.
 */
savedDocuments.delete(
  "/saved-documents/:documentId",
  requireAuth,
  async (c) => {
    const event = c.get("event")
    event.backend = env.BACKEND_MODE as
      | "local"
      | "datalab"
      | "modal"
    const documentId = c.req.param("documentId")
    const userId = c.get("userId")
    const storage = c.get("storage")
    event.documentId = documentId

    const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
    if (!convex) {
      event.error = {
        category: "auth",
        message: "Failed to authenticate with Convex",
        code: "CONVEX_AUTH_ERROR",
      }
      return c.json({ error: "Authentication failed" }, 401)
    }

    // Get document to retrieve storageId for S3 deletion
    const typedDocumentId = documentId as Id<"documents">
    const docResult = await tryCatch(
      convex.query(api.api.documents.get, { documentId: typedDocumentId }),
    )

    if (!docResult.success || !docResult.data) {
      event.error = {
        category: "storage",
        message: !docResult.success
          ? getErrorMessage(docResult.error)
          : "Document not found",
        code: "DOCUMENT_NOT_FOUND",
      }
      return c.json({ error: "Document not found" }, 404)
    }

    const storageId = docResult.data.storageId

    // Delete from Convex (handles auth + chunks)
    const removeResult = await tryCatch(
      convex.mutation(api.api.documents.remove, {
        documentId: typedDocumentId,
      }),
    )

    if (!removeResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(removeResult.error),
        code: "DOCUMENT_DELETE_ERROR",
      }
      return c.json({ error: "Failed to delete document" }, 500)
    }

    // Delete all storage files (best-effort, don't fail if files missing)
    const folderPrefix = `documents/${userId}/${storageId}/`
    await storage.deletePrefix(folderPrefix).catch(() => {})

    return c.json({ success: true })
  },
)

/**
 * Get a single PDF page as a PDF document.
 * Used for PDF page preview in the reader.
 */
savedDocuments.get(
  "/saved-documents/:documentId/page/:pageNum",
  requireAuth,
  async (c) => {
    const event = c.get("event")
    const documentId = c.req.param("documentId")
    const pageNum = parseInt(c.req.param("pageNum"), 10)
    const userId = c.get("userId")
    const storage = c.get("storage")

    if (isNaN(pageNum) || pageNum < 0) {
      return c.json({ error: "Invalid page number" }, 400)
    }

    const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
    if (!convex) {
      event.error = {
        category: "auth",
        message: "Failed to authenticate with Convex",
        code: "CONVEX_AUTH_ERROR",
      }
      return c.json({ error: "Authentication failed" }, 401)
    }

    const typedDocumentId = documentId as Id<"documents">
    const docResult = await tryCatch(
      convex.query(api.api.documents.get, { documentId: typedDocumentId }),
    )

    if (!docResult.success || !docResult.data) {
      event.error = {
        category: "storage",
        message: !docResult.success
          ? getErrorMessage(docResult.error)
          : "Document not found",
        code: "DOCUMENT_NOT_FOUND",
      }
      return c.json({ error: "Document not found" }, 404)
    }

    const storageId = docResult.data.storageId
    const pdfPath = `documents/${userId}/${storageId}/original.pdf`

    const pdfResult = await tryCatch(storage.readFile(pdfPath))
    if (!pdfResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(pdfResult.error),
        code: "PDF_READ_ERROR",
      }
      return c.json({ error: "PDF not found" }, 404)
    }

    const srcDoc = mupdf.Document.openDocument(
      pdfResult.data,
      "application/pdf",
    )
    try {
      const pageCount = srcDoc.countPages()
      if (pageNum >= pageCount) {
        return c.json({ error: "Page number out of range" }, 400)
      }

      // Create new PDF with single page
      const destDoc = new mupdf.PDFDocument()
      const srcPdf = srcDoc.asPDF()
      if (!srcPdf) {
        return c.json({ error: "Not a valid PDF" }, 400)
      }

      // pageNum from marker IDs is already 0-indexed (from Marker's block IDs)
      destDoc.graftPage(0, srcPdf, pageNum)
      const pdfBuffer = destDoc.saveToBuffer()
      destDoc.destroy()

      return new Response(pdfBuffer.asUint8Array(), {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=3600",
        },
      })
    } finally {
      srcDoc.destroy()
    }
  },
)
