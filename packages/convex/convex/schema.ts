import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  // Documents table - represents a converted PDF stored for RAG
  documents: defineTable({
    userId: v.string(),
    filename: v.string(),
    pageCount: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Chunks table - document segments with vector embeddings for RAG search
  chunks: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(), // Original Marker block ID
    blockType: v.string(), // "Text", "Heading", "ListItem", etc.
    content: v.string(), // Text content (HTML stripped)
    page: v.number(),
    section: v.optional(v.string()), // Section hierarchy flattened
    embedding: v.optional(v.array(v.float64())), // 768-dim Gemini embedding (added when AI chat opens)
  })
    .index("by_document", ["documentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768, // Gemini text-embedding-004
      filterFields: ["documentId"], // Scope vector search to specific document
    }),
})
