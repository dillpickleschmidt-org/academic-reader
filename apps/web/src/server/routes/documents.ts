import { Hono } from "hono"
import { z } from "zod"
import { requireAuth } from "../middleware/auth"
import { generateEmbeddings, stripHtmlForEmbedding } from "../services/embeddings"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"

// Schema for chunk input from frontend
const chunkSchema = z.object({
  id: z.string(),
  block_type: z.string(),
  html: z.string(),
  page: z.number(),
  section_hierarchy: z.record(z.string(), z.string()).optional(),
})

const storeRequestSchema = z.object({
  filename: z.string(),
  pageCount: z.number().optional(),
  chunks: z.array(chunkSchema),
})

export const documents = new Hono()

/**
 * Store document chunks with embeddings for RAG.
 * Called in parallel with summary generation.
 */
documents.post("/documents", requireAuth, async (c) => {
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

  const parseResult = storeRequestSchema.safeParse(bodyResult.data)
  if (!parseResult.success) {
    event.error = {
      category: "validation",
      message: parseResult.error.message,
      code: "VALIDATION_ERROR",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "Invalid request format", details: parseResult.error.issues }, 400)
  }

  const { filename, pageCount, chunks } = parseResult.data

  // Filter out empty chunks and prepare for embedding
  const validChunks = chunks
    .map((chunk) => ({
      blockId: chunk.id,
      blockType: chunk.block_type,
      content: stripHtmlForEmbedding(chunk.html),
      page: chunk.page,
      section: chunk.section_hierarchy
        ? Object.values(chunk.section_hierarchy).filter(Boolean).join(" > ")
        : undefined,
    }))
    .filter((chunk) => chunk.content.trim().length > 0)

  if (validChunks.length === 0) {
    event.error = {
      category: "validation",
      message: "No valid chunks to store",
      code: "EMPTY_CHUNKS",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "No valid chunks to store" }, 400)
  }

  // Generate embeddings
  const embedResult = await tryCatch(
    generateEmbeddings(validChunks.map((c) => c.content))
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

  // Call Convex mutation to store document (admin API on port 3210)
  const convexUrl = process.env.CONVEX_SITE_URL || "http://localhost:3210"

  // Get userId from auth middleware (already validated)
  const userId = c.get("userId")

  const storeResult = await tryCatch(
    fetch(`${convexUrl}/api/run/api/documents/store?format=json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        args: {
          userId, // Pass authenticated userId to Convex
          filename,
          pageCount,
          chunks: validChunks,
          embeddings,
        },
      }),
    })
  )

  if (!storeResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(storeResult.error),
      code: "CONVEX_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to store document" }, 500)
  }

  const response = storeResult.data
  if (!response.ok) {
    const errorText = await response.text()
    event.error = {
      category: "storage",
      message: errorText,
      code: "CONVEX_MUTATION_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to store document in Convex" }, 500)
  }

  const result = await response.json()

  emitStreamingEvent(event, {
    status: 200,
    durationMs: Math.round(performance.now() - startTime),
    chunkCount: validChunks.length,
    documentId: result.documentId,
  })

  return c.json({
    documentId: result.documentId,
    chunkCount: result.chunkCount,
  })
})
