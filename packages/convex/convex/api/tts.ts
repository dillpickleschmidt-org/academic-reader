/**
 * TTS API - thin layer for TTS cache operations.
 * Follows pattern: API defines args, calls model helpers.
 */

import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import * as TTS from "../model/tts"

// ===== Queries =====

/**
 * Get cached TTS for a document chunk.
 * Returns null if not cached.
 */
export const get = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  handler: (ctx, { documentId, blockId }) => TTS.getCachedTTS(ctx, documentId, blockId),
})

// ===== Mutations =====

/**
 * Cache reworded TTS text for a document chunk.
 */
export const cache = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    originalText: v.string(),
    rewordedText: v.string(),
  },
  handler: (ctx, args) => TTS.cacheTTS(ctx, args),
})

/**
 * Invalidate all TTS cache for a document.
 */
export const invalidate = mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => TTS.invalidateTTSCache(ctx, documentId),
})
