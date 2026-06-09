import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import {
  conversionTaskMetadataValidator,
  documentTaskKindValidator,
  documentTaskProgressValidator,
  documentTaskStatusValidator,
} from "../validators"
import * as DocumentTasks from "../model/documentTasks"

const nullableConversionTaskMetadataValidator = v.union(
  conversionTaskMetadataValidator,
  v.null(),
)
const nullableTaskProgressValidator = v.union(
  documentTaskProgressValidator,
  v.null(),
)

export const listForDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    DocumentTasks.listForDocument(ctx, documentId),
})

export const createForServer = mutation({
  args: {
    documentId: v.id("documents"),
    kind: documentTaskKindValidator,
    status: documentTaskStatusValidator,
    progress: nullableTaskProgressValidator,
    error: v.union(v.string(), v.null()),
    conversion: nullableConversionTaskMetadataValidator,
    apiToConvexServiceSecret: v.string(),
  },
  handler: (ctx, args) => DocumentTasks.createForDocumentServer(ctx, args),
})

export const updateForServer = mutation({
  args: {
    taskId: v.id("documentTasks"),
    status: v.optional(documentTaskStatusValidator),
    progress: v.optional(nullableTaskProgressValidator),
    error: v.optional(v.union(v.string(), v.null())),
    conversion: v.optional(nullableConversionTaskMetadataValidator),
    apiToConvexServiceSecret: v.string(),
  },
  handler: (ctx, { taskId, ...patch }) =>
    DocumentTasks.updateTaskServer(ctx, taskId, patch),
})
