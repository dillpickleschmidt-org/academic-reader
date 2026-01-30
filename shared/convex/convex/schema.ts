import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const tocSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  page: v.number(),
  children: v.optional(
    v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        page: v.number(),
      }),
    ),
  ),
})

const tocValidator = v.object({
  sections: v.array(tocSectionValidator),
  offset: v.number(),
  hasRomanNumerals: v.optional(v.boolean()),
})

export default defineSchema({
  // Documents table - represents a converted PDF stored for RAG
  documents: defineTable({
    userId: v.string(),
    filename: v.string(),
    /** UUID used as S3 storage path: documents/{userId}/{storageId}/ */
    storageId: v.string(),
    pageCount: v.optional(v.number()),
    toc: tocValidator,
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_storage", ["userId", "storageId"]),

  // Chunks table - document segments with vector embeddings for RAG search
  chunks: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    blockType: v.string(), // "Text", "Heading", "ListItem", etc.
    html: v.string(), // HTML content from Marker/CHANDRA
    page: v.number(),
    section: v.optional(v.string()), // Section hierarchy flattened
    bbox: v.array(v.number()), // [x1, y1, x2, y2] bounding box coordinates
    embedding: v.optional(v.array(v.float64())), // 768-dim Gemini embedding (added when AI chat opens)
  })
    .index("by_document", ["documentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768, // Gemini text-embedding-004
      filterFields: ["documentId"], // Scope vector search to specific document
    }),

  // TTS audio cache - stores synthesized audio metadata for reuse
  ttsAudio: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
    text: v.string(), // Full rewritten variation text
    storagePath: v.string(),
    durationMs: v.number(),
    sampleRate: v.number(),
    wordTimestamps: v.array(
      v.object({
        word: v.string(),
        startMs: v.number(),
        endMs: v.number(),
      }),
    ),
  }).index("by_document_block_voice", ["documentId", "blockId", "voiceId"]),
})
