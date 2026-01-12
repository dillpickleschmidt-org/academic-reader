/**
 * Route for generating embeddings for document chunks.
 * Called when AI chat is opened for a document.
 */
import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { requireAuth } from "../middleware/auth"
import { generateEmbeddings } from "../services/embeddings"
import { convex } from "../services/convex"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"

export const documentEmbeddings = new Hono()

/**
 * Generate embeddings for an existing document's chunks.
 * Called when AI chat is opened to enable vector search.
 *
 * POST /api/documents/:documentId/embeddings
 * Returns: { chunkCount: number }
 */
documentEmbeddings.post("/documents/:documentId/embeddings", requireAuth, async (c) => {
  const event = c.get("event")
  event.backend = (process.env.BACKEND_MODE || "local") as "local" | "runpod" | "datalab"
  const startTime = performance.now()

  const documentId = c.req.param("documentId")
  event.documentId = documentId
  const typedDocumentId = documentId as Id<"documents">

  // 1. Check if document already has embeddings
  const hasEmbeddingsResult = await tryCatch(
    convex.query(api.api.documents.hasEmbeddings, { documentId: typedDocumentId }),
  )

  if (!hasEmbeddingsResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(hasEmbeddingsResult.error),
      code: "CONVEX_QUERY_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to check embeddings status" }, 500)
  }

  if (hasEmbeddingsResult.data) {
    emitStreamingEvent(event, {
      status: 200,
      durationMs: Math.round(performance.now() - startTime),
      alreadyHasEmbeddings: true,
    })
    return c.json({ chunkCount: 0, alreadyHasEmbeddings: true })
  }

  // 2. Fetch chunks from Convex
  const chunksResult = await tryCatch(
    convex.query(api.api.documents.getChunks, { documentId: typedDocumentId }),
  )

  if (!chunksResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(chunksResult.error),
      code: "CONVEX_QUERY_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to fetch document chunks" }, 500)
  }

  const chunks = chunksResult.data
  if (!chunks || chunks.length === 0) {
    event.error = {
      category: "validation",
      message: "No chunks found for document",
      code: "NO_CHUNKS",
    }
    emitStreamingEvent(event, { status: 404 })
    return c.json({ error: "No chunks found for document" }, 404)
  }

  // 3. Generate embeddings
  const embedResult = await tryCatch(
    generateEmbeddings(chunks.map((c) => c.content)),
  )

  if (!embedResult.success) {
    event.error = {
      category: "internal",
      message: getErrorMessage(embedResult.error),
      code: "EMBEDDING_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to generate embeddings" }, 500)
  }

  const embeddings = embedResult.data

  // 4. Update chunks with embeddings
  const updateResult = await tryCatch(
    convex.mutation(api.api.documents.addEmbeddings, {
      documentId: typedDocumentId,
      embeddings,
    }),
  )

  if (!updateResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(updateResult.error),
      code: "CONVEX_MUTATION_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to update embeddings" }, 500)
  }

  emitStreamingEvent(event, {
    status: 200,
    durationMs: Math.round(performance.now() - startTime),
    chunkCount: chunks.length,
  })

  return c.json({ chunkCount: chunks.length })
})
