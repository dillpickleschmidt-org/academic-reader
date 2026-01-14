import type { Storage } from "./types"
import { S3Storage } from "./s3"

interface StorageEnv {
  S3_ENDPOINT?: string
  S3_PUBLIC_URL?: string
  S3_ACCESS_KEY?: string
  S3_SECRET_KEY?: string
  S3_BUCKET?: string
}

/**
 * Create S3-compatible storage.
 * Dev: credentials auto-provided by docker-compose (MinIO)
 * Prod: credentials must be set in deployment config (real S3/R2)
 */
export function createStorage(env: StorageEnv): Storage {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY || !env.S3_BUCKET) {
    throw new Error("Storage requires S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET")
  }

  return new S3Storage({
    endpoint: env.S3_ENDPOINT,
    publicUrl: env.S3_PUBLIC_URL,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
  })
}
