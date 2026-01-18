/**
 * TTS Segments API - thin layer for segmented TTS operations.
 * Follows pattern: API defines args, calls model helpers.
 */

import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import * as TTSSegments from "../model/ttsSegments"

// ===== Queries =====

/**
 * Get all segments for a block/variation.
 */
export const getSegments = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    variation: v.string(),
  },
  handler: (ctx, { documentId, blockId, variation }) =>
    TTSSegments.getSegments(ctx, documentId, blockId, variation),
})

/**
 * Get audio record for a specific segment/voice.
 */
export const getAudio = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    variation: v.string(),
    segmentIndex: v.number(),
    voiceId: v.string(),
  },
  handler: (ctx, { documentId, blockId, variation, segmentIndex, voiceId }) =>
    TTSSegments.getAudio(
      ctx,
      documentId,
      blockId,
      variation,
      segmentIndex,
      voiceId,
    ),
})

/**
 * Get all audio records for a block/variation/voice.
 */
export const getBlockAudio = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    variation: v.string(),
    voiceId: v.string(),
  },
  handler: (ctx, { documentId, blockId, variation, voiceId }) =>
    TTSSegments.getBlockAudio(ctx, documentId, blockId, variation, voiceId),
})

// ===== Mutations =====

/**
 * Create segments for a block/variation.
 */
export const createSegments = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    variation: v.string(),
    texts: v.array(v.string()),
  },
  handler: (ctx, args) => TTSSegments.createSegments(ctx, args),
})

/**
 * Create or update audio record for a segment/voice.
 */
export const createAudio = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    variation: v.string(),
    segmentIndex: v.number(),
    voiceId: v.string(),
    storagePath: v.string(),
    durationMs: v.number(),
    sampleRate: v.number(),
  },
  handler: (ctx, args) => TTSSegments.createAudio(ctx, args),
})

/**
 * Delete all TTS data for a specific block.
 */
export const deleteBlockData = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  handler: (ctx, { documentId, blockId }) =>
    TTSSegments.deleteBlockTTSData(ctx, documentId, blockId),
})

/**
 * Delete all TTS data for a document.
 */
export const deleteDocumentData = mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    TTSSegments.deleteDocumentTTSData(ctx, documentId),
})
