export type { UploadResult, PresignedUrlResult } from "../types"
export { S3Storage, type S3Config } from "./s3"
export { DiskStorage } from "./disk"
export { MemoryTempStorage, type TempStorage, type TempFile } from "./temp"
export { jobFileMap } from "./job-file-map"

import { S3Storage } from "./s3"
import { DiskStorage } from "./disk"

interface StorageEnv {
  BACKEND_MODE?: string
  S3_ENDPOINT?: string
  S3_ACCESS_KEY?: string
  S3_SECRET_KEY?: string
  S3_BUCKET?: string
}

/**
 * Create storage adapter based on environment.
 * Returns null for backends that don't need storage (local, datalab).
 */
export function createStorage(env: StorageEnv): S3Storage | null {
  if (env.BACKEND_MODE !== "runpod") {
    return null
  }

  if (
    !env.S3_ENDPOINT ||
    !env.S3_ACCESS_KEY ||
    !env.S3_SECRET_KEY ||
    !env.S3_BUCKET
  ) {
    throw new Error(
      "Runpod backend requires S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET",
    )
  }

  return new S3Storage({
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    bucket: env.S3_BUCKET,
  })
}

export type PersistentStorage = DiskStorage | S3Storage

/**
 * Create persistent storage for saved documents.
 * Uses S3 in production, local filesystem in development.
 */
export function createPersistentStorage(env: StorageEnv): PersistentStorage {
  const isProduction = process.env.NODE_ENV === "production"

  if (isProduction) {
    if (
      !env.S3_ENDPOINT ||
      !env.S3_ACCESS_KEY ||
      !env.S3_SECRET_KEY ||
      !env.S3_BUCKET
    ) {
      throw new Error(
        "Production requires S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET for persistent storage",
      )
    }

    return new S3Storage({
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
    })
  }

  return new DiskStorage()
}
