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
 * Store a document with pre-computed embeddings.
 * Called from web server after embedding generation.
 * Note: userId is passed explicitly since admin API calls don't have auth context.
 */
export const store = mutation({
  args: {
    userId: v.string(), // Passed from web server (already authenticated via middleware)
    filename: v.string(),
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
    embeddings: v.array(v.array(v.float64())),
  },
  handler: (ctx, args) =>
    Documents.storeDocument(ctx, {
      userId: args.userId,
      filename: args.filename,
      pageCount: args.pageCount,
      chunks: args.chunks,
      embeddings: args.embeddings,
    }),
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
 * Get a single document by ID.
 */
export const get = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getDocument(ctx, documentId),
})

// Internal query for getting chunk data (used by vector search)
export const getChunkInternal = internalQuery({
  args: {
    chunkId: v.id("chunks"),
  },
  handler: (ctx, { chunkId }) => Documents.getChunk(ctx, chunkId),
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
