/**
 * Document persistence service.
 * Handles saving and loading converted documents.
 *
 * Storage structure:
 *   documents/{userId}/{documentId}/original.pdf
 *   documents/{userId}/{documentId}/converted.html
 *   documents/{userId}/{documentId}/content.md
 */

import type { PersistentStorage } from "../storage"
import { convex } from "./convex"
import { api } from "@repo/convex/convex/_generated/api"

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
  userId: string
  filename: string
  pageCount?: number
  chunks: ChunkInput[]
  html: string
  markdown: string
  originalPdf: Buffer | null
}

/** Get file paths from userId and documentId */
export function getStoragePaths(userId: string, documentId: string) {
  return {
    original: `documents/${userId}/${documentId}/original.pdf`,
    html: `documents/${userId}/${documentId}/converted.html`,
    markdown: `documents/${userId}/${documentId}/content.md`,
  }
}

/**
 * Persist a document: create Convex record and save files to storage.
 */
export async function persistDocument(
  storage: PersistentStorage,
  input: PersistDocumentInput,
): Promise<string> {
  // 1. Create document + chunks in Convex
  const { documentId } = await convex.mutation(api.api.documents.create, {
    userId: input.userId,
    filename: input.filename,
    pageCount: input.pageCount,
    chunks: input.chunks,
  })

  // 2. Save files to storage
  const paths = getStoragePaths(input.userId, documentId)
  await Promise.all(
    [
      input.originalPdf && storage.saveFile(paths.original, input.originalPdf),
      storage.saveFile(paths.html, input.html),
      storage.saveFile(paths.markdown, input.markdown),
    ].filter(Boolean),
  )

  return documentId
}

/**
 * Load a persisted document's content from storage.
 */
export async function loadPersistedDocument(
  storage: PersistentStorage,
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
