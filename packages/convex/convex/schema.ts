import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import {
  chatRoleValidator,
  conversionTaskMetadataValidator,
  documentTaskKindValidator,
  documentTaskProgressValidator,
  documentTaskStatusValidator,
  messagePartValidator,
  tocValidator,
  wordTimestampValidator,
} from "./validators"

export default defineSchema({
  documents: defineTable({
    userId: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    pageCount: v.union(v.number(), v.null()),
    toc: v.union(tocValidator, v.null()),
    summary: v.union(v.string(), v.null()),
    color: v.number(),
  }).index("by_user", ["userId"]),

  documentTasks: defineTable({
    documentId: v.id("documents"),
    kind: documentTaskKindValidator,
    status: documentTaskStatusValidator,
    progress: v.union(documentTaskProgressValidator, v.null()),
    error: v.union(v.string(), v.null()),
    conversion: v.union(conversionTaskMetadataValidator, v.null()),
  })
    .index("by_document", ["documentId"])
    .index("by_document_kind", ["documentId", "kind"]),

  chunks: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    blockType: v.string(),
    html: v.string(),
    section: v.union(v.string(), v.null()),
    bbox: v.array(v.number()),
    order: v.number(),
    includeTts: v.union(v.boolean(), v.null()),
    ttsText: v.union(v.string(), v.null()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_document", ["documentId"])
    .index("by_document_block", ["documentId", "blockId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072,
      filterFields: ["documentId"],
    }),

  chatThreads: defineTable({
    userId: v.string(),
    documentId: v.union(v.id("documents"), v.null()),
    title: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_document", ["userId", "documentId"]),

  chatMessages: defineTable({
    threadId: v.id("chatThreads"),
    role: chatRoleValidator,
    parts: v.array(messagePartValidator),
    createdAt: v.number(),
  }).index("by_thread", ["threadId"]),

  ttsAudio: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
    storagePath: v.string(),
    durationMs: v.number(),
    sampleRate: v.number(),
    wordTimestamps: v.array(wordTimestampValidator),
  }).index("by_document_block_voice", ["documentId", "blockId", "voiceId"]),
})
