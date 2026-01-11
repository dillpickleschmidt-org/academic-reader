import type { S3Storage } from "../storage"
import { jobFileMap } from "../storage"

export interface CleanupResult {
  cleaned: boolean
  fileId?: string
  s3Deleted?: boolean
  s3Error?: string
}

/**
 * Clean up resources associated with a job.
 * Deletes S3 file (if runpod mode) and removes job-file mapping.
 * Returns results for the caller to attach to the wide event.
 */
export async function cleanupJob(
  jobId: string,
  storage: S3Storage | null,
): Promise<CleanupResult> {
  const entry = jobFileMap.get(jobId)

  if (!entry) {
    return { cleaned: false }
  }

  const { fileId, backendType } = entry
  let s3Deleted: boolean | undefined
  let s3Error: string | undefined

  // Only delete S3 files for runpod mode
  if (backendType === "runpod" && storage) {
    try {
      s3Deleted = await storage.deleteFile(fileId)
      if (!s3Deleted) {
        s3Error = "deleteFile returned false"
      }
    } catch (err) {
      s3Deleted = false
      s3Error = err instanceof Error ? err.message : String(err)
    }
  }

  // Always remove from tracking
  jobFileMap.delete(jobId)

  return { cleaned: true, fileId, s3Deleted, s3Error }
}
