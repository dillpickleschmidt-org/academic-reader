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

/** Options for saving files */
export interface SaveFileOptions {
  contentType?: string
}

/** Storage interface for all file operations */
export interface Storage {
  /** Save a file to storage */
  saveFile(key: string, content: string | Buffer, options?: SaveFileOptions): Promise<void>

  /** Read a file as bytes */
  readFile(key: string): Promise<Buffer>

  /** Read a file as string */
  readFileAsString(key: string): Promise<string>

  /** Delete a file */
  deleteFile(key: string): Promise<boolean>

  /** Delete all files with a given prefix (for folder cleanup) */
  deletePrefix(prefix: string): Promise<number>

  /** Get a URL for accessing a file (presigned URL, or tunnel URL in runpod mode)
   * @param internal - If true, returns internal Docker network URL (for worker access)
   */
  getFileUrl(key: string, internal?: boolean): Promise<string>

  /** Upload images to {docPath}/images/ and return public URLs */
  uploadImages(
    docPath: string,
    images: Record<string, string>,
  ): Promise<Record<string, string>>
}
