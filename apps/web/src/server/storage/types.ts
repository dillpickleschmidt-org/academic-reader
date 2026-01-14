/**
 * Get the storage path for a document.
 * - Signed-out users: temp_documents/{fileId}/
 * - Signed-in users: documents/{userId}/{fileId}/
 */
export function getDocumentPath(fileId: string, userId?: string): string {
  return userId
    ? `documents/${userId}/${fileId}`
    : `temp_documents/${fileId}`
}

/** Storage interface for all file operations */
export interface Storage {
  /** Save a file to storage */
  saveFile(key: string, content: string | Buffer): Promise<void>

  /** Read a file as bytes */
  readFile(key: string): Promise<Buffer>

  /** Read a file as string */
  readFileAsString(key: string): Promise<string>

  /** Delete a file */
  deleteFile(key: string): Promise<boolean>

  /** Get a presigned URL for a file (used by local/runpod backends to pass URL to worker) */
  getFileUrl(key: string): Promise<string>
}
