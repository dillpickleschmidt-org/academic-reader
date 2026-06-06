/**
 * Document model - business logic for RAG document operations.
 * All functions use requireAuth for Convex-native auth.
 */

import type { MutationCtx, QueryCtx, ActionCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { requireAuth } from "./auth"

export interface ChunkInput {
  blockId: string
  blockType: string
  html: string
  section: string | null
  bbox: number[]
  order: number
  includeTts: boolean | null
}

export type TocInput = NonNullable<Doc<"documents">["toc"]>

export interface CreateDocumentInput {
  filename: string
  /** UUID used as S3 storage path: documents/{userId}/{storageId}/ */
  storageId: string
  pageCount: number | null
  toc: TocInput | null
  chunks: ChunkInput[]
}

// ===== Mutation Helpers =====

/**
 * Create a document without chunks.
 * Chunks are added separately via addChunksToDocument to handle large documents.
 */
export async function createDocument(
  ctx: MutationCtx,
  input: Omit<CreateDocumentInput, "chunks">,
) {
  const user = await requireAuth(ctx)

  const documentId = await ctx.db.insert("documents", {
    userId: user._id,
    filename: input.filename,
    storageId: input.storageId,
    pageCount: input.pageCount,
    toc: input.toc,
    summary: null,
    color: Math.floor(Math.random() * 12), // 0-11 random color
    createdAt: Date.now(),
  })

  return {
    documentId,
    storageId: input.storageId,
  }
}

/**
 * Add chunks to an existing document.
 * Called in batches for large documents to avoid Convex transaction limits.
 */
export async function addChunksToDocument(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  chunks: ChunkInput[],
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Store chunks without embeddings
  await Promise.all(
    chunks.map((chunk) =>
      ctx.db.insert("chunks", {
        documentId,
        blockId: chunk.blockId,
        blockType: chunk.blockType,
        html: chunk.html,
        section: chunk.section,
        bbox: chunk.bbox,
        order: chunk.order,
        includeTts: chunk.includeTts,
        ttsText: null,
      }),
    ),
  )

  return { added: chunks.length }
}

/**
 * Update a document's table of contents.
 */
export async function updateDocumentToc(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  toc: TocInput,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  await ctx.db.patch(documentId, { toc })
  return { updated: true }
}

/**
 * Update a document's summary.
 */
export async function updateDocumentSummary(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  summary: string,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  await ctx.db.patch(documentId, { summary })
  return { updated: true }
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

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()
  const sortedChunks = chunks.sort((a, b) => a.order - b.order)

  if (sortedChunks.length !== embeddings.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) must match chunk count (${sortedChunks.length})`,
    )
  }

  await Promise.all(
    sortedChunks.map((chunk, i) =>
      ctx.db.patch(chunk._id, { embedding: embeddings[i] }),
    ),
  )

  return { updated: sortedChunks.length }
}

/**
 * Delete a document and all its chunks and cached audio.
 * @param threadAction - "keep" to unlink threads, "delete" to cascade delete threads and messages
 */
export async function deleteDocument(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  threadAction: "keep" | "delete",
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

  // Delete all cached TTS audio
  const audioRecords = await ctx.db
    .query("ttsAudio")
    .withIndex("by_document_block_voice", (q) => q.eq("documentId", documentId))
    .collect()

  // Handle chat threads based on threadAction
  const threads = await ctx.db
    .query("chatThreads")
    .withIndex("by_document", (q) =>
      q.eq("userId", user._id).eq("documentId", documentId),
    )
    .collect()

  let threadCount = 0
  let messageCount = 0

  if (threadAction === "delete") {
    // Cascade delete threads and their messages
    for (const thread of threads) {
      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .collect()
      await Promise.all(messages.map((m) => ctx.db.delete(m._id)))
      await ctx.db.delete(thread._id)
      threadCount++
      messageCount += messages.length
    }
  } else {
    // Unlink threads by clearing documentId
    await Promise.all(
      threads.map((thread) =>
        ctx.db.patch(thread._id, { documentId: null }),
      ),
    )
    threadCount = threads.length
  }

  await Promise.all([
    ...chunks.map((chunk) => ctx.db.delete(chunk._id)),
    ...audioRecords.map((audio) => ctx.db.delete(audio._id)),
  ])

  // Delete document
  await ctx.db.delete(documentId)

  return {
    deleted: true,
    chunkCount: chunks.length,
    audioCount: audioRecords.length,
    threadCount,
    messageCount,
    threadAction,
  }
}

// ===== Query Helpers =====

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

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  return chunks.sort((a, b) => a.order - b.order)
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
  html: string
  page: number
  section: string | null
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

  const results = await ctx.vectorSearch("chunks", "by_embedding", {
    vector: queryEmbedding,
    limit,
    filter: (q) => q.eq("documentId", documentId),
  })

  const chunks = await Promise.all(
    results.map((r) =>
      ctx.runQuery(internal.api.documents.getChunkInternal, {
        chunkId: r._id,
      }),
    ),
  )

  return chunks
    .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null)
    .map((chunk) => {
      const pageMatch = chunk.blockId.match(/^\/page\/(\d+)\//)
      return {
        html: chunk.html,
        page: pageMatch ? Number(pageMatch[1]) : 0,
        section: chunk.section,
      }
    })
}
