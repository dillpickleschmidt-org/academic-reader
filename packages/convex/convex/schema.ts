import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const toolBase = {
  toolCallId: v.string(),
  state: v.literal("output-available"),
}

const nullableString = v.union(v.string(), v.null())

const exaSearchResultValidator = v.object({
  title: v.string(),
  url: v.string(),
  id: nullableString,
  publishedDate: nullableString,
  author: nullableString,
  image: nullableString,
  favicon: nullableString,
  text: nullableString,
  highlights: v.union(v.array(v.string()), v.null()),
  highlightScores: v.union(v.array(v.number()), v.null()),
  summary: nullableString,
})

const exaResponseValidator = v.object({
  results: v.array(exaSearchResultValidator),
  requestId: v.union(v.string(), v.null()),
  resolvedSearchType: v.union(v.string(), v.null()),
  searchTime: v.union(v.number(), v.null()),
  costDollars: v.union(v.any(), v.null()),
  effectiveFilters: v.union(v.any(), v.null()),
  requestTags: v.union(v.any(), v.null()),
})

export const messagePartValidator = v.union(
  v.object({ type: v.literal("text"), text: v.string() }),
  v.object({
    type: v.literal("tool-searchDocument"),
    ...toolBase,
    input: v.object({ query: v.string() }),
    output: v.string(),
  }),
  v.object({
    type: v.literal("tool-webSearch"),
    ...toolBase,
    input: v.object({ query: v.string() }),
    output: exaResponseValidator,
  }),
  v.object({
    type: v.literal("tool-extractPage"),
    ...toolBase,
    input: v.object({ url: v.string() }),
    output: v.string(),
  }),
)

export const tocSectionValidator = v.object({
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

export const tocValidator = v.object({
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
    pageCount: v.union(v.number(), v.null()),
    toc: v.union(tocValidator, v.null()),
    summary: v.union(v.string(), v.null()),
    color: v.number(), // 0-11 index into color palette
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Chunks table - document segments with vector embeddings for RAG search
  chunks: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    blockType: v.string(), // "Text", "Heading", "ListItem", etc.
    html: v.string(), // HTML content from Marker/CHANDRA
    section: v.union(v.string(), v.null()), // Section hierarchy flattened
    bbox: v.array(v.number()), // [x1, y1, x2, y2] bounding box coordinates
    order: v.number(), // Stable reading order within the document
    includeTts: v.union(v.boolean(), v.null()), // null until TTS preparation finishes
    ttsText: v.union(v.string(), v.null()), // LLM-rewritten text for natural TTS speech
    embedding: v.optional(v.array(v.float64())), // 3072-dim Gemini embedding (added when AI chat opens)
  })
    .index("by_document", ["documentId"])
    .index("by_document_block", ["documentId", "blockId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072, // Gemini gemini-embedding-001
      filterFields: ["documentId"], // Scope vector search to specific document
    }),

  // Chat threads - persistent AI chat conversations per document
  chatThreads: defineTable({
    userId: v.string(),
    documentId: v.union(v.id("documents"), v.null()), // null for unlinked threads
    title: v.union(v.string(), v.null()),
    isStreaming: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]) // list all threads
    .index("by_document", ["userId", "documentId"]),

  // Chat messages - individual messages within a thread
  chatMessages: defineTable({
    threadId: v.id("chatThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    parts: v.array(messagePartValidator),
    createdAt: v.number(),
  }).index("by_thread", ["threadId"]),

  // TTS audio cache - stores synthesized audio metadata for reuse
  ttsAudio: defineTable({
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
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
