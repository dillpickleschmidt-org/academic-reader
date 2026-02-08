/**
 * Documents API - thin layer for document CRUD operations.
 * Follows nihongo-ninja pattern: API defines args, calls model helpers.
 */

import { v } from "convex/values"
import {
  mutation,
  query,
  action,
  internalQuery,
} from "../_generated/server"
import { tocValidator } from "../schema"
import * as Documents from "../model/documents"

// ===== Mutations =====

/**
 * Create a document without chunks.
 * Chunks should be added separately using addChunks mutation.
 */
export const create = mutation({
  args: {
    filename: v.string(),
    storageId: v.string(),
    pageCount: v.optional(v.number()),
    toc: v.optional(tocValidator),
  },
  handler: (ctx, args) => Documents.createDocument(ctx, args),
})

/**
 * Add chunks to an existing document (batched).
 * Called multiple times for large documents to avoid Convex limits.
 */
export const addChunks = mutation({
  args: {
    documentId: v.id("documents"),
    chunks: v.array(
      v.object({
        blockId: v.string(),
        blockType: v.string(),
        html: v.string(),
        section: v.optional(v.string()),
        bbox: v.array(v.number()),
        includeTts: v.optional(v.boolean()),
      }),
    ),
  },
  handler: (ctx, args) => Documents.addChunksToDocument(ctx, args.documentId, args.chunks),
})

/**
 * Update a document's table of contents after background extraction.
 */
export const updateToc = mutation({
  args: {
    documentId: v.id("documents"),
    toc: tocValidator,
  },
  handler: (ctx, { documentId, toc }) =>
    Documents.updateDocumentToc(ctx, documentId, toc),
})

/**
 * Update a document's summary after background generation.
 */
export const updateSummary = mutation({
  args: {
    documentId: v.id("documents"),
    summary: v.string(),
  },
  handler: (ctx, { documentId, summary }) =>
    Documents.updateDocumentSummary(ctx, documentId, summary),
})

/**
 * Bulk-update includeTts flags on chunks after background filtering.
 */
export const updateChunksTtsFlags = mutation({
  args: {
    documentId: v.id("documents"),
    flags: v.array(
      v.object({
        blockId: v.string(),
        includeTts: v.boolean(),
      }),
    ),
  },
  handler: (ctx, { documentId, flags }) =>
    Documents.updateChunksTtsFlags(ctx, documentId, flags),
})

/**
 * Bulk-update ttsText on chunks after background rewriting.
 */
export const updateChunksTtsText = mutation({
  args: {
    documentId: v.id("documents"),
    texts: v.array(
      v.object({
        blockId: v.string(),
        ttsText: v.string(),
      }),
    ),
  },
  handler: (ctx, { documentId, texts }) =>
    Documents.updateChunksTtsText(ctx, documentId, texts),
})

/**
 * Add embeddings to existing chunks.
 * Called when AI chat opens.
 */
export const addEmbeddings = mutation({
  args: {
    documentId: v.id("documents"),
    embeddings: v.array(v.array(v.float64())),
  },
  handler: (ctx, { documentId, embeddings }) =>
    Documents.addEmbeddings(ctx, documentId, embeddings),
})

/**
 * Delete a document and all its chunks.
 */
export const remove = mutation({
  args: {
    documentId: v.id("documents"),
    threadAction: v.union(v.literal("keep"), v.literal("delete")),
  },
  handler: (ctx, { documentId, threadAction }) =>
    Documents.deleteDocument(ctx, documentId, threadAction),
})

// ===== Queries =====

/**
 * Get all documents for the current user.
 */
export const list = query({
  args: {},
  handler: (ctx) => Documents.getUserDocuments(ctx),
})

/**
 * Get persisted documents (with storage paths) for the current user.
 */
export const listPersisted = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: (ctx, { limit }) => Documents.getPersistedDocuments(ctx, limit),
})

/**
 * Get a single document by ID.
 */
export const get = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getDocument(ctx, documentId),
})

/**
 * Get all chunks for a document.
 * Used when AI chat opens to generate embeddings.
 */
export const getChunks = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getChunksForDocument(ctx, documentId),
})

/**
 * Get TTS enrichment data for all chunks in a document.
 * Lightweight projection — only returns blockId, includeTts, and ttsText.
 */
export const getTtsEnrichments = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, { documentId }) => {
    const chunks = await Documents.getChunksForDocument(ctx, documentId)
    return chunks.map((c) => ({
      blockId: c.blockId,
      includeTts: c.includeTts,
      ttsText: c.ttsText,
    }))
  },
})

/**
 * Check if a document has embeddings generated.
 */
export const hasEmbeddings = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.hasEmbeddings(ctx, documentId),
})

// Internal query for getting chunk data (used by vector search)
export const getChunkInternal = internalQuery({
  args: {
    chunkId: v.id("chunks"),
  },
  handler: (ctx, { chunkId }) => Documents.getChunk(ctx, chunkId),
})

// Internal query to verify document access (throws if unauthorized)
export const verifyDocumentAccess = internalQuery({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getDocument(ctx, documentId),
})

// ===== Actions =====

/**
 * Search document chunks using vector similarity.
 * Requires query embedding to be pre-computed by caller.
 */
export const search = action({
  args: {
    documentId: v.id("documents"),
    queryEmbedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: (ctx, args) => Documents.searchChunks(ctx, args),
})
