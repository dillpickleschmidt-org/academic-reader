import type { UploadResult, PresignedUrlResult } from '../types';

export type { UploadResult, PresignedUrlResult };

/**
 * Interface for file storage adapters.
 * S3-compatible: works with R2, MinIO, AWS S3.
 */
export interface StorageAdapter {
  /**
   * Storage adapter name
   */
  readonly name: string;

  /**
   * Upload file directly
   */
  uploadFile(file: ArrayBuffer, filename: string, contentType: string): Promise<UploadResult>;

  /**
   * Get presigned URL for direct upload (for large files)
   */
  getPresignedUploadUrl(filename: string): Promise<PresignedUrlResult>;

  /**
   * Get URL for backend to access the file
   */
  getFileUrl(fileId: string): Promise<string>;
}
