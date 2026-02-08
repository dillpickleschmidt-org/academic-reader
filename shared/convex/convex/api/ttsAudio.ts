/**
 * TTS audio cache API - thin layer for audio caching operations.
 */

import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import * as TtsAudio from "../model/ttsAudio"

/**
 * Get cached audio for a block/voice combination.
 */
export const getBlockAudio = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
  },
  handler: (ctx, { documentId, blockId, voiceId }) =>
    TtsAudio.getBlockAudio(ctx, documentId, blockId, voiceId),
})

/**
 * Check if any audio exists for a document+voice combination.
 */
export const hasDocumentAudio = query({
  args: {
    documentId: v.id("documents"),
    voiceId: v.string(),
  },
  handler: (ctx, { documentId, voiceId }) =>
    TtsAudio.hasDocumentAudio(ctx, documentId, voiceId),
})

/**
 * Create or overwrite an audio cache record.
 */
export const createAudio = mutation({
  args: {
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
  },
  handler: (ctx, args) => TtsAudio.createAudio(ctx, args),
})
