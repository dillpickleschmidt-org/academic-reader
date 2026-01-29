/**
 * Shared processing logic for job completion.
 *
 * Used by both streaming (local backend) and polling (cloud backends) paths.
 */

import type { WideEvent } from "../../types"
import type { Storage } from "../../storage/types"
import { jobFileMap } from "../../storage/job-file-map"
import { cleanupJob } from "../../cleanup/job-cleanup"
import {
  processHtml,
  removeImgDescriptions,
  wrapCitations,
  processParagraphs,
  convertMathToHtml,
  wrapTablesInScrollContainers,
  rewriteImageSources,
  injectPageMarkers,
} from "../../utils/html-processing"
import {
  extractTableOfContents,
  type TocResult,
} from "../../services/toc-extraction"
import { extractLinkMappings, injectLinks } from "../../services/link-extraction"
import { persistDocument, type ChunkInput } from "../../services/document-persistence"
import { createAuthenticatedConvexClient } from "../../services/convex"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type CleanupReason = "cancelled" | "failed" | "timeout" | "client_disconnect"

/** Marker chunk format */
interface MarkerChunkBlock {
  id: string
  block_type: string
  html: string
  page: number
  bbox: number[]
  section_hierarchy?: Record<string, string>
}

/** CHANDRA chunk format */
interface ChandraChunkBlock {
  label: string
  content: string
  bbox: number[]
  page: number
}

type WorkerChunkBlock = MarkerChunkBlock | ChandraChunkBlock

export interface JobResultFormats {
  html?: string
  markdown?: string
  chunks?: {
    blocks?: WorkerChunkBlock[]
  }
}

export interface JobResultInput {
  content?: string
  metadata?: { pages?: number }
  formats?: JobResultFormats
  images?: Record<string, string>
}

import type { WorkerName } from "../../workers/registry"

export interface FileInfo {
  filename: string
  fileId: string
  documentPath: string
  worker?: WorkerName
  userId?: string
}

export interface ProcessedJobResult {
  content: string
  imageUrls?: Record<string, string>
  toc?: TocResult
  documentId?: string
}

interface NormalizedChunk {
  id: string
  blockType: string
  html: string
  page: number
  bbox: number[]
  sectionHierarchy?: Record<string, string>
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
} as const

/** HTML transforms applied to all content */
export const HTML_TRANSFORMS = [
  removeImgDescriptions,
  wrapCitations,
  processParagraphs,
  convertMathToHtml,
  wrapTablesInScrollContainers,
]

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Handle cleanup for cancelled/failed/timeout jobs.
 */
export function handleCleanup(
  event: WideEvent,
  jobId: string,
  reason: CleanupReason,
): void {
  const result = cleanupJob(jobId)
  event.cleanup = { reason, ...result }
}

function normalizeChunk(block: WorkerChunkBlock, index: number): NormalizedChunk {
  if ("id" in block) {
    return {
      id: block.id,
      blockType: block.block_type,
      html: block.html,
      page: block.page,
      bbox: block.bbox,
      sectionHierarchy: block.section_hierarchy,
    }
  }
  // CHANDRA format
  return {
    id: `chandra-${index}`,
    blockType: block.label,
    html: block.content,
    page: block.page,
    bbox: block.bbox,
  }
}

function transformChunks(chunks: NormalizedChunk[]): ChunkInput[] {
  return chunks.map((chunk) => ({
    blockId: chunk.id,
    blockType: chunk.blockType,
    html: chunk.html,
    page: chunk.page,
    section: chunk.sectionHierarchy
      ? Object.values(chunk.sectionHierarchy).filter(Boolean).join(" > ")
      : undefined,
    bbox: chunk.bbox,
  }))
}

/**
 * Process a completed job: upload images, rewrite URLs, save to S3, persist to Convex.
 * Shared by both streaming and polling paths.
 */
export async function processCompletedJob(
  _jobId: string,
  result: JobResultInput,
  fileInfo: FileInfo | undefined,
  storage: Storage,
  event: WideEvent,
  headers?: Headers,
): Promise<ProcessedJobResult> {
  // Upload images and get public URLs
  let imageUrls: Record<string, string> | undefined
  if (
    result.images &&
    Object.keys(result.images).length > 0 &&
    fileInfo?.documentPath
  ) {
    const uploadResult = await tryCatch(
      storage.uploadImages(fileInfo.documentPath, result.images),
    )
    if (uploadResult.success) {
      imageUrls = uploadResult.data
      event.imageCount = Object.keys(imageUrls).length
    } else {
      event.error = {
        category: "storage",
        message: getErrorMessage(uploadResult.error),
        code: "IMAGE_UPLOAD_FAILED",
      }
    }
  }

  // Rewrite image sources in display content
  let processedContent = result.content || ""
  if (imageUrls && processedContent) {
    processedContent = rewriteImageSources(processedContent, imageUrls)
  }

  // Apply HTML enhancements
  if (processedContent) {
    processedContent = processHtml(processedContent, HTML_TRANSFORMS)
  }

  // Extract and inject PDF links + TOC (all backends)
  const chunks = result.formats?.chunks?.blocks
  let tocResult: TocResult | undefined
  let pageOffset = 0

  if (!chunks?.length || !fileInfo?.documentPath) {
    event.tocStatus = "skipped"
  } else if (chunks?.length && fileInfo?.documentPath) {
    const chunkPageInfo = chunks.map((c, i) => ({
      id: "id" in c ? c.id : `chandra-${i}`,
      page: c.page,
    }))

    // Try to read PDF for link extraction and TOC
    const pdfReadResult = await tryCatch(
      storage.readFile(`${fileInfo.documentPath}/original.pdf`),
    )

    if (pdfReadResult.success) {
      const pdfBuffer = pdfReadResult.data

      // Extract PDF links
      try {
        const mappings = extractLinkMappings(pdfBuffer)

        if (mappings.length) {
          const { html: linkedHtml, linkCount } = injectLinks(
            processedContent,
            mappings,
            chunkPageInfo,
          )
          processedContent = linkedHtml
          event.linkCount = linkCount

          // Also inject into formats.html for storage/download
          if (result.formats?.html) {
            result.formats.html = injectLinks(
              result.formats.html,
              mappings,
              chunkPageInfo,
            ).html
          }
        }
      } catch (err) {
        console.warn("[jobs] Link extraction failed:", err)
      }

      // Extract table of contents
      try {
        const textContent = result.formats?.markdown || result.content || ""
        const tocExtractResult = await tryCatch(
          extractTableOfContents(textContent, pdfBuffer),
        )
        if (tocExtractResult.success) {
          const { toc, meta } = tocExtractResult.data
          event.tocStatus = meta.status
          event.tocOffsetDetected = meta.offsetDetected
          if (toc) {
            tocResult = toc
            pageOffset = toc.offset
            event.tocSections = toc.sections.length
          }
        } else {
          console.warn("[jobs] TOC extraction failed:", tocExtractResult.error)
          event.tocStatus = "error"
        }
      } catch (err) {
        console.warn("[jobs] TOC extraction failed (uncaught):", err)
        event.tocStatus = "error"
      }
    } else {
      console.warn("[jobs] Failed to read PDF for link extraction:", pdfReadResult.error)
      event.tocStatus = "pdf_read_failed"
    }

    // Inject page markers (always runs, uses offset=0 as fallback)
    try {
      processedContent = injectPageMarkers(processedContent, chunkPageInfo, pageOffset)

      if (result.formats?.html) {
        result.formats.html = injectPageMarkers(result.formats.html, chunkPageInfo, pageOffset)
      }
    } catch (err) {
      console.warn("[jobs] Page marker injection failed:", err)
    }
  }

  // Rewrite image sources in formats.html for storage
  if (imageUrls && result.formats?.html) {
    result.formats.html = rewriteImageSources(result.formats.html, imageUrls)
  }

  // Save to S3
  if (result.formats && fileInfo?.documentPath) {
    const saveResult = await tryCatch(
      Promise.all([
        storage.saveFile(
          `${fileInfo.documentPath}/content.html`,
          result.formats.html || "",
        ),
        storage.saveFile(
          `${fileInfo.documentPath}/content.md`,
          result.formats.markdown || "",
        ),
      ]),
    )
    if (!saveResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(saveResult.error),
        code: "S3_SAVE_FAILED",
      }
    }
  } else if (fileInfo?.documentPath) {
    event.error = {
      category: "backend",
      message: "No formats data in result - content not saved",
      code: "MISSING_FORMATS",
    }
  }

  // Inline persistence to Convex
  let documentId: string | undefined
  if (fileInfo && headers) {
    const convex = await createAuthenticatedConvexClient(headers)
    if (convex) {
      const normalizedChunks = (result.formats?.chunks?.blocks ?? []).map((block, index) =>
        normalizeChunk(block, index),
      )
      const chunksForPersistence = transformChunks(normalizedChunks)

      const persistResult = await tryCatch(
        persistDocument(convex, {
          fileId: fileInfo.fileId,
          filename: fileInfo.filename,
          pageCount: result.metadata?.pages,
          chunks: chunksForPersistence,
        }),
      )

      if (persistResult.success) {
        documentId = persistResult.data
        event.documentId = documentId
      } else {
        console.warn("[jobs] Failed to persist document:", persistResult.error)
        event.error = {
          category: "storage",
          message: getErrorMessage(persistResult.error),
          code: "PERSIST_ERROR",
        }
      }
    } else {
      console.warn("[jobs] Failed to create authenticated Convex client")
    }
  }

  return { content: processedContent, imageUrls, toc: tocResult, documentId }
}

/**
 * Get file info for a job from the job file map.
 */
export function getJobFileInfo(jobId: string): FileInfo | undefined {
  return jobFileMap.get(jobId)
}

/**
 * Remove file info for a job from the job file map.
 */
export function clearJobFileInfo(jobId: string): void {
  jobFileMap.delete(jobId)
}
