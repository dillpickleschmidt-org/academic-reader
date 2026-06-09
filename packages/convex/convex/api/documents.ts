/**
 * Documents API - thin layer for document CRUD operations.
 */

import { v } from "convex/values"
import { mutation, query, action, internalQuery } from "../_generated/server"
import {
  chunkInputValidator,
  createDocumentInputValidator,
  threadActionValidator,
  tocValidator,
} from "../validators"
import * as Documents from "../model/documents"

export const create = mutation({
  args: createDocumentInputValidator,
  handler: (ctx, args) => Documents.createDocument(ctx, args),
})

export const addChunksForServer = mutation({
  args: {
    documentId: v.id("documents"),
    chunks: v.array(chunkInputValidator),
    apiToConvexServiceSecret: v.string(),
  },
  handler: (ctx, args) =>
    Documents.addChunksToDocumentServer(
      ctx,
      args.documentId,
      args.chunks,
      args.apiToConvexServiceSecret,
    ),
})

export const updateTocForServer = mutation({
  args: {
    documentId: v.id("documents"),
    toc: tocValidator,
    apiToConvexServiceSecret: v.string(),
  },
  handler: (ctx, { documentId, toc, apiToConvexServiceSecret }) =>
    Documents.updateDocumentTocServer(
      ctx,
      documentId,
      toc,
      apiToConvexServiceSecret,
    ),
})

export const updateSummaryForServer = mutation({
  args: {
    documentId: v.id("documents"),
    summary: v.string(),
    apiToConvexServiceSecret: v.string(),
  },
  handler: (ctx, { documentId, summary, apiToConvexServiceSecret }) =>
    Documents.updateDocumentSummaryServer(
      ctx,
      documentId,
      summary,
      apiToConvexServiceSecret,
    ),
})

export const addEmbeddings = mutation({
  args: {
    documentId: v.id("documents"),
    embeddings: v.array(v.array(v.float64())),
  },
  handler: (ctx, { documentId, embeddings }) =>
    Documents.addEmbeddings(ctx, documentId, embeddings),
})

export const remove = mutation({
  args: {
    documentId: v.id("documents"),
    threadAction: threadActionValidator,
  },
  handler: (ctx, { documentId, threadAction }) =>
    Documents.deleteDocument(ctx, documentId, threadAction),
})

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: (ctx, { limit }) => Documents.listDocuments(ctx, limit),
})

export const get = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getDocument(ctx, documentId),
})

export const getChunks = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    Documents.getChunksForDocument(ctx, documentId),
})

export const hasEmbeddings = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.hasEmbeddings(ctx, documentId),
})

export const getChunkInternal = internalQuery({
  args: {
    chunkId: v.id("chunks"),
  },
  handler: (ctx, { chunkId }) => ctx.db.get(chunkId),
})

export const verifyDocumentAccess = internalQuery({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Documents.getDocument(ctx, documentId),
})

export const search = action({
  args: {
    documentId: v.id("documents"),
    queryEmbedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: (ctx, args) => Documents.searchChunks(ctx, args),
})
