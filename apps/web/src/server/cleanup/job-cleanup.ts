import { jobFileMap } from "../storage/job-file-map"

export interface CleanupResult {
  cleaned: boolean
  documentPath?: string
}

/**
 * Clean up resources associated with a job.
 * Removes job-file mapping. Files are not deleted:
 * - temp_documents/ are auto-cleaned by S3 lifecycle after 7 days
 * - documents/ are permanent and managed by user
 */
export function cleanupJob(jobId: string): CleanupResult {
  const entry = jobFileMap.get(jobId)

  if (!entry) {
    return { cleaned: false }
  }

  const { documentPath } = entry

  // Remove from tracking (files are not deleted)
  jobFileMap.delete(jobId)

  return { cleaned: true, documentPath }
}
