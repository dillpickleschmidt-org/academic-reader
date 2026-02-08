import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const toolBase = {
  toolCallId: v.string(),
  state: v.literal("output-available"),
}

const nullableString = v.optional(v.nullable(v.string()))

const exaSearchResultValidator = v.object({
  title: v.string(),
  url: v.string(),
  id: nullableString,
  publishedDate: nullableString,
  author: nullableString,
  image: nullableString,
  favicon: nullableString,
  text: nullableString,
  highlights: v.optional(v.nullable(v.array(v.string()))),
  highlightScores: v.optional(v.nullable(v.array(v.number()))),
  summary: nullableString,
})

const exaResponseValidator = v.object({
  results: v.array(exaSearchResultValidator),
  requestId: v.optional(v.string()),
  resolvedSearchType: v.optional(v.string()),
  searchTime: v.optional(v.number()),
  costDollars: v.optional(v.any()),
  effectiveFilters: v.optional(v.any()),
  requestTags: v.optional(v.any()),
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
    toc: v.optional(tocValidator),
    summary: v.optional(v.string()),
    color: v.number(), // 0-11 index into color palette
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
    section: v.optional(v.string()), // Section hierarchy flattened
    bbox: v.array(v.number()), // [x1, y1, x2, y2] bounding box coordinates
    includeTts: v.optional(v.boolean()), // Whether block should be read aloud by TTS
    ttsText: v.optional(v.string()), // LLM-rewritten text for natural TTS speech
    embedding: v.optional(v.array(v.float64())), // 3072-dim Gemini embedding (added when AI chat opens)
  })
    .index("by_document", ["documentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 3072, // Gemini gemini-embedding-001
      filterFields: ["documentId"], // Scope vector search to specific document
    }),

  // Chat threads - persistent AI chat conversations per document
  chatThreads: defineTable({
    userId: v.string(),
    documentId: v.optional(v.id("documents")), // optional for unlinked threads
    title: v.optional(v.string()),
    isStreaming: v.optional(v.boolean()),
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
