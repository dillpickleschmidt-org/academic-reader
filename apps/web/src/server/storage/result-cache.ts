/**
 * Temporary cache for conversion results.
 * Stores results after conversion completes so they can be persisted
 * by a separate authenticated request.
 */

import type { ChunkInput } from "../services/document-persistence"

export interface CachedResult {
  html: string
  markdown: string
  chunks: ChunkInput[]
  metadata: { pages?: number }
  filename: string
  /** The fileId (UUID for unauthenticated, Convex documentId for authenticated) */
  fileId: string
  /** Document storage path (e.g., "documents/{userId}/{fileId}" or "temp_documents/{fileId}") */
  documentPath: string
  cachedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

class ResultCache {
  private cache = new Map<string, CachedResult>()

  constructor() {
    // Run cleanup every minute
    setInterval(() => this.cleanup(), 60 * 1000)
  }

  set(jobId: string, result: Omit<CachedResult, "cachedAt">): void {
    this.cache.set(jobId, { ...result, cachedAt: Date.now() })
  }

  get(jobId: string): CachedResult | null {
    const entry = this.cache.get(jobId)
    if (!entry) return null

    // Check if expired
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(jobId)
      return null
    }

    return entry
  }

  delete(jobId: string): boolean {
    return this.cache.delete(jobId)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [jobId, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        this.cache.delete(jobId)
      }
    }
  }

  // For testing/debugging
  size(): number {
    return this.cache.size
  }
}

export const resultCache = new ResultCache()
