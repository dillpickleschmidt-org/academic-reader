/**
 * TTS model - business logic for TTS cache operations.
 * Stores LLM-reworded text for spoken prose (per chunk).
 */

import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { requireAuth } from "./auth"

export interface CacheTTSInput {
  documentId: Id<"documents">
  blockId: string
  originalText: string
  rewordedText: string
}

// ===== Query Helpers =====

/**
 * Get cached TTS for a specific document chunk.
 * Returns null if not cached.
 */
export async function getCachedTTS(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  blockId: string,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const cached = await ctx.db
    .query("ttsCache")
    .withIndex("by_document_block", (q) =>
      q.eq("documentId", documentId).eq("blockId", blockId),
    )
    .unique()

  return cached ? { rewordedText: cached.rewordedText } : null
}

// ===== Mutation Helpers =====

/**
 * Cache reworded TTS text for a document chunk.
 * Replaces existing cache if present.
 */
export async function cacheTTS(ctx: MutationCtx, input: CacheTTSInput) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(input.documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  // Check for existing cache entry
  const existing = await ctx.db
    .query("ttsCache")
    .withIndex("by_document_block", (q) =>
      q.eq("documentId", input.documentId).eq("blockId", input.blockId),
    )
    .unique()

  if (existing) {
    // Update existing entry
    await ctx.db.patch(existing._id, {
      originalText: input.originalText,
      rewordedText: input.rewordedText,
      createdAt: Date.now(),
    })
    return { id: existing._id, updated: true }
  }

  // Create new entry
  const id = await ctx.db.insert("ttsCache", {
    documentId: input.documentId,
    blockId: input.blockId,
    originalText: input.originalText,
    rewordedText: input.rewordedText,
    createdAt: Date.now(),
  })

  return { id, updated: false }
}

/**
 * Invalidate all TTS cache for a document.
 * Called when document is re-processed.
 */
export async function invalidateTTSCache(
  ctx: MutationCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)

  // Verify document ownership
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const entries = await ctx.db
    .query("ttsCache")
    .withIndex("by_document_block", (q) => q.eq("documentId", documentId))
    .collect()

  await Promise.all(entries.map((entry) => ctx.db.delete(entry._id)))

  return { deleted: entries.length }
}
