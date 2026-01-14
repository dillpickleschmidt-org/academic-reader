import type { BackendType } from "@repo/core/types/api"

interface JobFileEntry {
  /** Document storage path (e.g., "documents/{userId}/{fileId}" or "temp_documents/{fileId}") */
  documentPath: string
  /** The fileId portion of the path */
  fileId: string
  filename: string
  backendType: BackendType
  createdAt: number
}

/**
 * In-memory map tracking job -> file associations for cleanup.
 * Entries expire after TTL (checked on access) to handle edge cases
 * where a job is registered but never completes through normal flow.
 */
class JobFileMap {
  private map = new Map<string, JobFileEntry>()
  private readonly TTL_MS = 30 * 60 * 1000 // 30 minutes

  /**
   * Register a job -> file association.
   * @param documentPath Full document path (e.g., "documents/{userId}/{fileId}" or "temp_documents/{fileId}")
   * @param fileId The fileId for this document
   */
  set(jobId: string, documentPath: string, fileId: string, filename: string, backendType: BackendType): void {
    this.map.set(jobId, { documentPath, fileId, filename, backendType, createdAt: Date.now() })
  }

  /**
   * Get file info for a job. Returns undefined if not found or expired.
   */
  get(jobId: string): JobFileEntry | undefined {
    const entry = this.map.get(jobId)
    if (!entry) return undefined

    // Check TTL
    if (Date.now() - entry.createdAt > this.TTL_MS) {
      this.map.delete(jobId)
      return undefined
    }

    return entry
  }

  /**
   * Remove a job from tracking (after cleanup or completion).
   */
  delete(jobId: string): void {
    this.map.delete(jobId)
  }
}

// Singleton instance
export const jobFileMap = new JobFileMap()
