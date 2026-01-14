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
import * as Documents from "../model/documents"

// ===== Mutations =====

/**
 * Create a document with chunks (no embeddings).
 * Called at persist time for authenticated users.
 */
export const create = mutation({
  args: {
    filename: v.string(),
    storageId: v.string(),
    pageCount: v.optional(v.number()),
    chunks: v.array(
      v.object({
        blockId: v.string(),
        blockType: v.string(),
        content: v.string(),
        page: v.number(),
        section: v.optional(v.string()),
      }),
    ),
  },
  handler: (ctx, args) =>
    Documents.createDocumentWithChunks(ctx, {
      filename: args.filename,
      storageId: args.storageId,
      pageCount: args.pageCount,
      chunks: args.chunks,
    }),
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
  },
  handler: (ctx, { documentId }) => Documents.deleteDocument(ctx, documentId),
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
