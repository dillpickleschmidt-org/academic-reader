/**
 * Document model - business logic for RAG document operations.
 * Note: storeDocument accepts userId from web server (pre-authenticated).
 * Other functions use requireAuth for Convex-native auth.
 */

import type { MutationCtx, QueryCtx, ActionCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { requireAuth } from "./auth"

// Types matching Marker's ChunkBlock (simplified for storage)
export interface ChunkInput {
  blockId: string
  blockType: string
  content: string // Already stripped HTML
  page: number
  section?: string
}

export interface DocumentInput {
  userId: string // Passed from web server (pre-authenticated)
  filename: string
  pageCount?: number
  chunks: ChunkInput[]
  embeddings: number[][] // Pre-computed embeddings
}

// ===== Mutation Helpers =====

/**
 * Store a document with its chunks and pre-computed embeddings.
 * Called from the web server after embedding generation.
 * Note: Auth is already verified by web server middleware, userId is passed directly.
 */
export async function storeDocument(ctx: MutationCtx, input: DocumentInput) {
  // Validate embeddings match chunks
  if (input.embeddings.length !== input.chunks.length) {
    throw new Error(
      `Embedding count (${input.embeddings.length}) must match chunk count (${input.chunks.length})`,
    )
  }

  // Create document record (userId is pre-validated by web server)
  const documentId = await ctx.db.insert("documents", {
    userId: input.userId,
    filename: input.filename,
    pageCount: input.pageCount,
    createdAt: Date.now(),
  })

  // Create chunk records with embeddings
  await Promise.all(
    input.chunks.map((chunk, i) =>
      ctx.db.insert("chunks", {
        documentId,
        blockId: chunk.blockId,
        blockType: chunk.blockType,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
        embedding: input.embeddings[i],
      }),
    ),
  )

  return { documentId, chunkCount: input.chunks.length }
}

/**
 * Delete a document and all its chunks.
 */
export async function deleteDocument(
  ctx: MutationCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) {
    throw new Error("Document not found")
  }
  if (doc.userId !== user._id) {
    throw new Error("Unauthorized")
  }

  // Delete all chunks
  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  await Promise.all(chunks.map((chunk) => ctx.db.delete(chunk._id)))

  // Delete document
  await ctx.db.delete(documentId)

  return { deleted: true, chunkCount: chunks.length }
}

// ===== Query Helpers =====

/**
 * Get all documents for the current user.
 */
export async function getUserDocuments(ctx: QueryCtx) {
  const user = await requireAuth(ctx)

  return ctx.db
    .query("documents")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .order("desc")
    .collect()
}

/**
 * Get a document by ID (with ownership check).
 */
export async function getDocument(ctx: QueryCtx, documentId: Id<"documents">) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) {
    throw new Error("Document not found")
  }
  if (doc.userId !== user._id) {
    throw new Error("Unauthorized")
  }

  return doc
}

/**
 * Get a chunk by ID (internal, no auth - called after vector search).
 */
export async function getChunk(ctx: QueryCtx, chunkId: Id<"chunks">) {
  return ctx.db.get(chunkId)
}

// ===== Action Helpers (for vector search) =====

interface ChunkSearchResult {
  content: string
  blockType: string
  page: number
  section: string | undefined
  score: number
}

/**
 * Search chunks using vector similarity.
 * Called from an action context since vectorSearch requires it.
 */
export async function searchChunks(
  ctx: ActionCtx,
  args: {
    documentId: Id<"documents">
    queryEmbedding: number[]
    limit?: number
  },
): Promise<ChunkSearchResult[]> {
  const { documentId, queryEmbedding, limit = 5 } = args

  // Vector search
  const results = await ctx.vectorSearch("chunks", "by_embedding", {
    vector: queryEmbedding,
    limit: limit * 2, // Fetch extra to filter by document
  })

  // Filter by document and take top N
  // Note: Convex vector search doesn't support filtering in the query itself yet
  // So we fetch more and filter client-side
  const chunksWithScores = await Promise.all(
    results.map(async (r) => {
      const chunk = await ctx.runQuery(internal.api.documents.getChunkInternal, {
        chunkId: r._id,
      })
      if (!chunk) return null
      return { chunk, score: r._score }
    }),
  )

  return chunksWithScores
    .filter((c): c is NonNullable<typeof c> => c !== null && c.chunk.documentId === documentId)
    .slice(0, limit)
    .map((c) => ({
      content: c.chunk.content,
      blockType: c.chunk.blockType,
      page: c.chunk.page,
      section: c.chunk.section,
      score: c.score,
    }))
}
