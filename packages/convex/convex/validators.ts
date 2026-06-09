import { v, type Infer } from "convex/values"

const nullableStringValidator = v.union(v.string(), v.null())

// === Chat / AI tool validators ===
const toolBase = {
  toolCallId: v.string(),
  state: v.literal("output-available"),
}

const exaSearchResultValidator = v.object({
  title: v.string(),
  url: v.string(),
  id: nullableStringValidator,
  publishedDate: nullableStringValidator,
  author: nullableStringValidator,
  image: nullableStringValidator,
  favicon: nullableStringValidator,
  text: nullableStringValidator,
  highlights: v.union(v.array(v.string()), v.null()),
  highlightScores: v.union(v.array(v.number()), v.null()),
  summary: nullableStringValidator,
})

const exaResponseValidator = v.object({
  results: v.array(exaSearchResultValidator),
  requestId: nullableStringValidator,
  resolvedSearchType: nullableStringValidator,
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

export const chatRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
)

export const threadActionValidator = v.union(
  v.literal("keep"),
  v.literal("delete"),
)

// === Document validators ===
const tocChildValidator = v.object({
  id: v.string(),
  title: v.string(),
  page: v.number(),
})

const tocSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  page: v.number(),
  children: v.optional(v.array(tocChildValidator)),
})

export const tocValidator = v.object({
  sections: v.array(tocSectionValidator),
  offset: v.number(),
  hasRomanNumerals: v.optional(v.boolean()),
})

const processingModeValidator = v.union(
  v.literal("fast"),
  v.literal("balanced"),
  v.literal("aggressive"),
)

export const conversionTaskMetadataValidator = v.object({
  processingMode: processingModeValidator,
  useLlm: v.boolean(),
  forceOcr: v.boolean(),
  pageRange: v.string(),
  audioVoiceId: v.union(v.string(), v.null()),
  backendJobId: v.union(v.string(), v.null()),
})

const createDocumentConversionValidator = v.object({
  processingMode: processingModeValidator,
  useLlm: v.boolean(),
  forceOcr: v.boolean(),
  pageRange: v.string(),
  audioVoiceId: v.union(v.string(), v.null()),
})

export const chunkInputValidator = v.object({
  blockId: v.string(),
  blockType: v.string(),
  html: v.string(),
  section: v.union(v.string(), v.null()),
  bbox: v.array(v.number()),
  order: v.number(),
  includeTts: v.union(v.boolean(), v.null()),
})

export const createDocumentInputValidator = v.object({
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  pageCount: v.union(v.number(), v.null()),
  conversion: createDocumentConversionValidator,
})

// === Document task validators ===
export const documentTaskKindValidator = v.union(
  v.literal("conversion"),
  v.literal("toc"),
  v.literal("summary"),
  v.literal("tts-prep"),
  v.literal("tts-audio"),
)

export const documentTaskStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
)

export const documentTaskProgressValidator = v.object({
  label: v.string(),
  current: v.number(),
  total: v.number(),
})

// === TTS validators ===
export const wordTimestampValidator = v.object({
  word: v.string(),
  startMs: v.number(),
  endMs: v.number(),
})

export const ttsChunkPreparationValidator = v.object({
  blockId: v.string(),
  includeTts: v.boolean(),
  ttsText: v.union(v.string(), v.null()),
})

export type ChatRole = Infer<typeof chatRoleValidator>
export type MessagePart = Infer<typeof messagePartValidator>
export type ThreadAction = Infer<typeof threadActionValidator>
export type Toc = Infer<typeof tocValidator>
export type ConversionTaskMetadata = Infer<typeof conversionTaskMetadataValidator>
export type CreateDocumentInput = Infer<typeof createDocumentInputValidator>
export type ChunkInput = Infer<typeof chunkInputValidator>
export type DocumentTaskKind = Infer<typeof documentTaskKindValidator>
export type DocumentTaskStatus = Infer<typeof documentTaskStatusValidator>
export type DocumentTaskProgress = Infer<typeof documentTaskProgressValidator>
export type WordTimestamp = Infer<typeof wordTimestampValidator>
export type TtsChunkPreparation = Infer<typeof ttsChunkPreparationValidator>
