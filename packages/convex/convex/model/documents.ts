/**
 * Document model - business logic for RAG document operations.
 * All functions use requireAuth for Convex-native auth.
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

export interface CreateDocumentInput {
  filename: string
  /** UUID used as S3 storage path: documents/{userId}/{storageId}/ */
  storageId: string
  pageCount?: number
  chunks: ChunkInput[] // Without embeddings
}

// ===== Mutation Helpers =====

/**
 * Create a document with chunks (no embeddings).
 * Called at persist time for authenticated users.
 * Embeddings are added later when AI chat opens.
 */
export async function createDocumentWithChunks(
  ctx: MutationCtx,
  input: CreateDocumentInput,
) {
  const user = await requireAuth(ctx)

  const documentId = await ctx.db.insert("documents", {
    userId: user._id,
    filename: input.filename,
    storageId: input.storageId,
    pageCount: input.pageCount,
    createdAt: Date.now(),
  })

  // Store chunks without embeddings
  await Promise.all(
    input.chunks.map((chunk) =>
      ctx.db.insert("chunks", {
        documentId,
        blockId: chunk.blockId,
        blockType: chunk.blockType,
        content: chunk.content,
        page: chunk.page,
        section: chunk.section,
      }),
    ),
  )

  return {
    documentId,
    storageId: input.storageId,
    chunkCount: input.chunks.length,
  }
}

/**
 * Add embeddings to existing chunks.
 * Called when AI chat opens to enable vector search.
 */
export async function addEmbeddings(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  embeddings: number[][],
) {
  // Verify ownership
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Get chunks in insertion order
  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) must match chunk count (${chunks.length})`,
    )
  }

  // Update each chunk with its embedding
  await Promise.all(
    chunks.map((chunk, i) =>
      ctx.db.patch(chunk._id, { embedding: embeddings[i] }),
    ),
  )

  return { updated: chunks.length }
}

/**
 * Delete a document and all its chunks and TTS data.
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

  // Delete all TTS segments
  const ttsSegments = await ctx.db
    .query("ttsSegments")
    .withIndex("by_document_block_variation", (q) =>
      q.eq("documentId", documentId),
    )
    .collect()

  // Delete all TTS audio records
  const ttsAudio = await ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) => q.eq("documentId", documentId))
    .collect()

  await Promise.all([
    ...chunks.map((chunk) => ctx.db.delete(chunk._id)),
    ...ttsSegments.map((seg) => ctx.db.delete(seg._id)),
    ...ttsAudio.map((audio) => ctx.db.delete(audio._id)),
  ])

  // Delete document
  await ctx.db.delete(documentId)

  return {
    deleted: true,
    chunkCount: chunks.length,
    ttsSegmentCount: ttsSegments.length,
    ttsAudioCount: ttsAudio.length,
  }
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
 * Get persisted documents for the current user.
 * All documents are persisted (files stored alongside chunks).
 */
export async function getPersistedDocuments(ctx: QueryCtx, limit?: number) {
  const user = await requireAuth(ctx)

  const query = ctx.db
    .query("documents")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .order("desc")

  return limit ? query.take(limit) : query.collect()
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

/**
 * Get all chunks for a document (for embedding generation).
 */
export async function getChunksForDocument(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  return ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()
}

/**
 * Check if a document has embeddings (at least one chunk with embedding).
 */
export async function hasEmbeddings(
  ctx: QueryCtx,
  documentId: Id<"documents">,
): Promise<boolean> {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(1)

  return chunks.length > 0 && chunks[0].embedding !== undefined
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
 * Verifies document ownership before searching.
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

  // Verify user owns this document (throws if unauthorized or not found)
  await ctx.runQuery(internal.api.documents.verifyDocumentAccess, {
    documentId,
  })

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
      const chunk = await ctx.runQuery(
        internal.api.documents.getChunkInternal,
        {
          chunkId: r._id,
        },
      )
      if (!chunk) return null
      return { chunk, score: r._score }
    }),
  )

  return chunksWithScores
    .filter(
      (c): c is NonNullable<typeof c> =>
        c !== null && c.chunk.documentId === documentId,
    )
    .slice(0, limit)
    .map((c) => ({
      content: c.chunk.content,
      blockType: c.chunk.blockType,
      page: c.chunk.page,
      section: c.chunk.section,
      score: c.score,
    }))
}
