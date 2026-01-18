/**
 * TTS Segments model - business logic for segmented TTS storage.
 * Stores chunked reworded text (≤300 chars) and audio file references.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { requireAuth } from "./auth"

export interface CreateSegmentsInput {
  documentId: Id<"documents">
  blockId: string
  variation: string
  texts: string[]
}

export interface CreateAudioInput {
  documentId: Id<"documents">
  blockId: string
  variation: string
  segmentIndex: number
  voiceId: string
  storagePath: string
  durationMs: number
  sampleRate: number
}

// ===== Query Helpers =====

/**
 * Get all segments for a block/variation.
 * Returns empty array if none exist.
 */
export async function getSegments(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  blockId: string,
  variation: string,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const segments = await ctx.db
    .query("ttsSegments")
    .withIndex("by_document_block_variation", (q) =>
      q
        .eq("documentId", documentId)
        .eq("blockId", blockId)
        .eq("variation", variation),
    )
    .collect()

  // Sort by index
  return segments.sort((a, b) => a.index - b.index)
}

/**
 * Get audio record for a specific segment/voice.
 * Returns null if not generated.
 */
export async function getAudio(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  blockId: string,
  variation: string,
  segmentIndex: number,
  voiceId: string,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  return ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) =>
      q
        .eq("documentId", documentId)
        .eq("blockId", blockId)
        .eq("variation", variation)
        .eq("segmentIndex", segmentIndex)
        .eq("voiceId", voiceId),
    )
    .unique()
}

/**
 * Get all audio records for a block/variation/voice.
 * Used to check what's already generated.
 */
export async function getBlockAudio(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  blockId: string,
  variation: string,
  voiceId: string,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const audioRecords = await ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) =>
      q
        .eq("documentId", documentId)
        .eq("blockId", blockId)
        .eq("variation", variation),
    )
    .collect()

  // Filter by voiceId and sort by segmentIndex
  return audioRecords
    .filter((r) => r.voiceId === voiceId)
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
}

// ===== Mutation Helpers =====

/**
 * Create segments for a block/variation.
 * Replaces existing segments if present.
 */
export async function createSegments(
  ctx: MutationCtx,
  input: CreateSegmentsInput,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(input.documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Delete existing segments for this block/variation
  const existing = await ctx.db
    .query("ttsSegments")
    .withIndex("by_document_block_variation", (q) =>
      q
        .eq("documentId", input.documentId)
        .eq("blockId", input.blockId)
        .eq("variation", input.variation),
    )
    .collect()

  await Promise.all(existing.map((s) => ctx.db.delete(s._id)))

  // Create new segments
  const now = Date.now()
  const ids = await Promise.all(
    input.texts.map((text, index) =>
      ctx.db.insert("ttsSegments", {
        documentId: input.documentId,
        blockId: input.blockId,
        variation: input.variation,
        index,
        text,
        createdAt: now,
      }),
    ),
  )

  return { ids, count: ids.length }
}

/**
 * Create or update audio record for a segment/voice.
 */
export async function createAudio(ctx: MutationCtx, input: CreateAudioInput) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(input.documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Check for existing audio record
  const existing = await ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) =>
      q
        .eq("documentId", input.documentId)
        .eq("blockId", input.blockId)
        .eq("variation", input.variation)
        .eq("segmentIndex", input.segmentIndex)
        .eq("voiceId", input.voiceId),
    )
    .unique()

  if (existing) {
    // Update existing record
    await ctx.db.patch(existing._id, {
      storagePath: input.storagePath,
      durationMs: input.durationMs,
      sampleRate: input.sampleRate,
      createdAt: Date.now(),
    })
    return { id: existing._id, updated: true }
  }

  // Create new record
  const id = await ctx.db.insert("ttsAudio", {
    documentId: input.documentId,
    blockId: input.blockId,
    variation: input.variation,
    segmentIndex: input.segmentIndex,
    voiceId: input.voiceId,
    storagePath: input.storagePath,
    durationMs: input.durationMs,
    sampleRate: input.sampleRate,
    createdAt: Date.now(),
  })

  return { id, updated: false }
}

/**
 * Delete all TTS data for a specific block.
 */
export async function deleteBlockTTSData(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  blockId: string,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Delete segments
  const segments = await ctx.db
    .query("ttsSegments")
    .withIndex("by_document_block_variation", (q) =>
      q.eq("documentId", documentId).eq("blockId", blockId),
    )
    .collect()

  // Delete audio records
  const audioRecords = await ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) =>
      q.eq("documentId", documentId).eq("blockId", blockId),
    )
    .collect()

  await Promise.all([
    ...segments.map((s) => ctx.db.delete(s._id)),
    ...audioRecords.map((a) => ctx.db.delete(a._id)),
  ])

  return {
    deletedSegments: segments.length,
    deletedAudio: audioRecords.length,
  }
}

/**
 * Delete all TTS data for a document.
 * Called when document is deleted.
 */
export async function deleteDocumentTTSData(
  ctx: MutationCtx,
  documentId: Id<"documents">,
) {
  // Note: No auth check here - called internally during document deletion

  // Delete all segments for document
  const segments = await ctx.db
    .query("ttsSegments")
    .withIndex("by_document_block_variation", (q) =>
      q.eq("documentId", documentId),
    )
    .collect()

  // Delete all audio records for document
  const audioRecords = await ctx.db
    .query("ttsAudio")
    .withIndex("by_segment_voice", (q) => q.eq("documentId", documentId))
    .collect()

  await Promise.all([
    ...segments.map((s) => ctx.db.delete(s._id)),
    ...audioRecords.map((a) => ctx.db.delete(a._id)),
  ])

  return {
    deletedSegments: segments.length,
    deletedAudio: audioRecords.length,
  }
}
