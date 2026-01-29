import type { BackendType } from "@repo/core/types/api"
import type { WorkerName } from "../workers/registry"

interface JobFileEntry {
  /** Document storage path (e.g., "documents/{userId}/{fileId}" or "temp_documents/{fileId}") */
  documentPath: string
  /** The fileId portion of the path */
  fileId: string
  filename: string
  backendType: BackendType
  /** Worker to use for this job (local mode only) */
  worker?: WorkerName
  /** User ID for authenticated requests (used for inline persistence) */
  userId?: string
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
   * @param worker Optional worker name for local mode model activation
   * @param userId Optional user ID for authenticated requests (used for inline persistence)
   */
  set(
    jobId: string,
    documentPath: string,
    fileId: string,
    filename: string,
    backendType: BackendType,
    worker?: WorkerName,
    userId?: string,
  ): void {
    this.map.set(jobId, { documentPath, fileId, filename, backendType, worker, userId, createdAt: Date.now() })
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
