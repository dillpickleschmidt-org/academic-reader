/**
 * Shared job ID utilities for routing between Marker and CHANDRA workers.
 *
 * Job IDs are prefixed to identify which worker to query:
 * - "marker:abc123" → Marker worker (fast mode)
 * - "chandra:abc123" → CHANDRA worker (accurate mode)
 * - "abc123" → Legacy format, assumed to be Marker
 */

export type WorkerType = "marker" | "chandra"

/**
 * Prefix a raw job ID with the worker type.
 */
export function prefixJobId(rawId: string, worker: WorkerType): string {
  return `${worker}:${rawId}`
}

/**
 * Parse a prefixed job ID to extract the worker type and raw ID.
 */
export function parseJobId(jobId: string): { worker: WorkerType; rawId: string } {
  if (jobId.startsWith("chandra:")) {
    return { worker: "chandra", rawId: jobId.slice(8) }
  }
  if (jobId.startsWith("marker:")) {
    return { worker: "marker", rawId: jobId.slice(7) }
  }
  // Legacy: no prefix, assume marker
  return { worker: "marker", rawId: jobId }
}

/**
 * Determine which worker to use based on processing mode.
 */
export function getWorkerFromProcessingMode(
  processingMode: string | undefined,
): WorkerType {
  return processingMode === "accurate" ? "chandra" : "marker"
}
