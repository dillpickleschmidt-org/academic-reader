export type { StorageAdapter, UploadResult, PresignedUrlResult } from './interface';
export { S3Storage, type S3Config } from './s3';
export { MemoryTempStorage, KVTempStorage, type TempStorage, type TempFile } from './temp';

import { S3Storage } from './s3';
import type { StorageAdapter } from './interface';

interface StorageEnv {
  CONVERSION_BACKEND?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_BUCKET?: string;
  S3_PUBLIC_URL?: string;
}

/**
 * Create storage adapter based on environment.
 * Returns null for backends that don't need storage (local, datalab).
 */
export function createStorage(env: StorageEnv): StorageAdapter | null {
  // Only Runpod needs file storage
  if (env.CONVERSION_BACKEND !== 'runpod') {
    return null;
  }

  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY || !env.S3_BUCKET) {
    throw new Error('Runpod backend requires S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET');
  }

  return new S3Storage({
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
    publicUrl: env.S3_PUBLIC_URL,
  });
}
