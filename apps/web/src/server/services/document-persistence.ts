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

/** Chunk input for document creation */
export interface ChunkInput {
  blockId: string
  blockType: string
  content: string
  page: number
  section?: string
}

/** Input for persisting a document */
export interface PersistDocumentInput {
  /** UUID used as S3 storage path */
  fileId: string
  filename: string
  pageCount?: number
  chunks: ChunkInput[]
}

/**
 * Create Convex record with chunks.
 * Files are stored at documents/{userId}/{storageId}/.
 */
export async function persistDocument(
  convex: ConvexHttpClient,
  input: PersistDocumentInput,
): Promise<string> {
  const { documentId } = await convex.mutation(api.api.documents.create, {
    filename: input.filename,
    storageId: input.fileId,
    pageCount: input.pageCount,
    chunks: input.chunks,
  })

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
