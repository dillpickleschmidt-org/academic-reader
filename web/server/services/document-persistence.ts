/**
 * Document persistence service.
 * Handles saving and loading converted documents.
 *
 * Storage structure:
 *   documents/{userId}/{documentId}/original.pdf
 *   documents/{userId}/{documentId}/content.html
 *   documents/{userId}/{documentId}/content.md
 */

import type { Storage } from "../storage/types"
import type { ConvexHttpClient } from "convex/browser"
import { api } from "@repo/convex/convex/_generated/api"

/** Get file paths from userId and documentId */
export function getStoragePaths(userId: string, documentId: string) {
  return {
    original: `documents/${userId}/${documentId}/original.pdf`,
    html: `documents/${userId}/${documentId}/content.html`,
    markdown: `documents/${userId}/${documentId}/content.md`,
  }
}

import type { TocResult } from "@repo/core/types/api"

/** Chunk input for document creation */
export interface ChunkInput {
  blockId: string
  blockType: string
  html: string
  page: number
  section?: string
  bbox: number[]
}

/** Input for persisting a document */
export interface PersistDocumentInput {
  /** UUID used as S3 storage path */
  fileId: string
  filename: string
  pageCount?: number
  toc: TocResult
  chunks: ChunkInput[]
}

// Batch size for chunk insertions (stay well under Convex's 8192 write limit and 1MB arg limit)
const CHUNK_BATCH_SIZE = 200

/**
 * Create Convex record with chunks.
 * Files are stored at documents/{userId}/{storageId}/.
 * Chunks are inserted in batches to avoid Convex transaction limits.
 */
export async function persistDocument(
  convex: ConvexHttpClient,
  input: PersistDocumentInput,
): Promise<string> {
  // Create document first (without chunks)
  const { documentId } = await convex.mutation(api.api.documents.create, {
    filename: input.filename,
    storageId: input.fileId,
    pageCount: input.pageCount,
    toc: input.toc,
  })

  // Add chunks in batches to avoid Convex limits (1MB arg size, 8192 writes/tx)
  const chunks = input.chunks
  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
    await convex.mutation(api.api.documents.addChunks, {
      documentId: documentId as any, // Type narrowing for Id<"documents">
      chunks: batch,
    })
  }

  return documentId
}

/**
 * Load a persisted document's content from storage.
 */
export async function loadPersistedDocument(
  storage: Storage,
  userId: string,
  documentId: string,
): Promise<{ html: string; markdown: string }> {
  const paths = getStoragePaths(userId, documentId)

  const [html, markdown] = await Promise.all([
    storage.readFileAsString(paths.html),
    storage.readFileAsString(paths.markdown),
  ])

  return { html, markdown }
}
