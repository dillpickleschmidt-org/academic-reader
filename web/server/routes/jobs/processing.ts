/**
 * Shared processing logic for job completion.
 *
 * Used by both streaming (local backend) and polling (cloud backends) paths.
 */

import type { WideEvent } from "../../types"
import type { Storage } from "../../storage/types"
import { jobFileMap } from "../../storage/job-file-map"
import { resultCache } from "../../storage/result-cache"
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
import { stripHtmlForEmbedding } from "../../services/embeddings"
import { extractLinkMappings, injectLinks } from "../../services/link-extraction"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"
import type { ChunkInput } from "../../services/document-persistence"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type CleanupReason = "cancelled" | "failed" | "timeout" | "client_disconnect"

export interface JobResultFormats {
  html?: string
  markdown?: string
  chunks?: {
    blocks?: Array<{
      id: string
      block_type: string
      html: string
      page: number
      bbox?: number[]
      section_hierarchy?: Record<string, string>
    }>
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
}

export interface ProcessedJobResult {
  content: string
  imageUrls?: Record<string, string>
  toc?: TocResult
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

/**
 * Process chunks and cache job result for persistence.
 */
export function cacheJobResult(
  jobId: string,
  result: JobResultInput,
  fileInfo: FileInfo,
): ChunkInput[] {
  const rawChunks = result.formats?.chunks?.blocks ?? []
  const chunks: ChunkInput[] = rawChunks
    .map((chunk) => ({
      blockId: chunk.id,
      blockType: chunk.block_type,
      content: stripHtmlForEmbedding(chunk.html ?? ""),
      page: chunk.page,
      section: chunk.section_hierarchy
        ? Object.values(chunk.section_hierarchy).filter(Boolean).join(" > ")
        : undefined,
    }))
    .filter((c) => c.content.trim().length > 0)

  resultCache.set(jobId, {
    html: result.formats?.html ?? result.content ?? "",
    markdown: result.formats?.markdown ?? "",
    chunks,
    metadata: { pages: result.metadata?.pages },
    filename: fileInfo.filename,
    fileId: fileInfo.fileId,
    documentPath: fileInfo.documentPath,
  })

  return chunks
}

/**
 * Process a completed job: upload images, rewrite URLs, save to S3, cache for persistence.
 * Shared by both streaming and polling paths.
 */
export async function processCompletedJob(
  jobId: string,
  result: JobResultInput,
  fileInfo: FileInfo | undefined,
  storage: Storage,
  event: WideEvent,
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

  if (chunks?.length && fileInfo?.documentPath) {
    const chunkPageInfo = chunks.map((c) => ({ id: c.id, page: c.page }))

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
        if (tocExtractResult.success && tocExtractResult.data) {
          tocResult = tocExtractResult.data
          pageOffset = tocResult.offset
          event.tocSections = tocResult.sections.length
        }
      } catch (err) {
        console.warn("[jobs] TOC extraction failed:", err)
      }
    } else {
      console.warn("[jobs] Failed to read PDF for link extraction:", pdfReadResult.error)
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
  }

  // Cache for persistence
  if (fileInfo) {
    cacheJobResult(jobId, { ...result, content: processedContent }, fileInfo)
  }

  return { content: processedContent, imageUrls, toc: tocResult }
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
