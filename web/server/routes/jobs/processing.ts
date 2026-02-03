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
  HTML_TRANSFORMS,
  rewriteImageSources,
  injectPageMarkers,
} from "../../utils/html-processing"
import {
  extractTableOfContents,
  type TocResult,
} from "../../services/toc-extraction"
import { filterBlocksForTTS } from "../../services/tts-block-filter"
import type { ProgressData } from "../../utils/sse-transform"
import type { ChunkBlock } from "@repo/core/types/api"
import {
  extractLinkMappings,
  injectLinks,
  type BboxMap,
  type PageDimensions,
} from "../../services/link-extraction"
import {
  persistDocument,
  type ChunkInput,
} from "../../services/document-persistence"
import { createAuthenticatedConvexClient } from "../../services/convex"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type CleanupReason =
  | "cancelled"
  | "failed"
  | "timeout"
  | "client_disconnect"

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
    page_info?: Record<string, { bbox: number[]; polygon: number[][] }>
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
  blocks: ChunkBlock[]
  imageUrls?: Record<string, string>
  toc?: TocResult
  documentId?: string
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

// Re-export for consumers that import from here
export { HTML_TRANSFORMS } from "../../utils/html-processing"

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

function normalizeChunk(
  block: WorkerChunkBlock,
  index: number,
): ChunkBlock {
  if ("id" in block) {
    return {
      id: block.id,
      block_type: block.block_type,
      html: block.html,
      page: block.page,
      bbox: block.bbox,
      polygon: [],
      includeTts: false,
      section_hierarchy: block.section_hierarchy,
    }
  }
  return {
    id: `chandra-${index}`,
    block_type: block.label,
    html: block.content,
    page: block.page,
    bbox: block.bbox,
    polygon: [],
    includeTts: false,
  }
}

function transformChunks(chunks: ChunkBlock[]): ChunkInput[] {
  return chunks.map((chunk) => ({
    blockId: chunk.id,
    blockType: chunk.block_type,
    html: chunk.html,
    page: chunk.page,
    section: chunk.section_hierarchy
      ? Object.values(chunk.section_hierarchy).filter(Boolean).join(" > ")
      : undefined,
    bbox: chunk.bbox,
    includeTts: chunk.includeTts,
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
  emitProgress?: (progress: ProgressData) => void,
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

  const rawChunks = result.formats?.chunks?.blocks ?? []
  const normalizedChunks = rawChunks.map((block, index) =>
    normalizeChunk(block, index),
  )
  event.chunkCount = normalizedChunks.length

  // Extract and inject PDF links + TOC (all backends)
  let tocResult: TocResult | undefined
  let blockFilter: Record<string, boolean> | undefined
  let pageOffset = 0

  if (!normalizedChunks.length || !fileInfo?.documentPath) {
    event.tocStatus = "skipped"
  } else {
    // Try to read PDF for link extraction and TOC
    const pdfReadResult = await tryCatch(
      storage.readFile(`${fileInfo.documentPath}/original.pdf`),
    )

    if (pdfReadResult.success) {
      const pdfBuffer = pdfReadResult.data

      // Extract and inject PDF links (datalab only - for some reason it's broken so I handle it manually)
      if (event.backend === "datalab") {
        try {
          const mappings = extractLinkMappings(pdfBuffer)
          if (mappings.length) {
            // Build bbox map and get page dimensions from Marker's page_info
            const bboxMap: BboxMap = new Map()
            const pageDims: PageDimensions = new Map()

            for (const chunk of normalizedChunks) {
              if (chunk.bbox.length === 4) {
                bboxMap.set(chunk.id, chunk.bbox as [number, number, number, number])
              }
            }

            // Get actual page dimensions from Marker's page_info (bbox is [0, 0, width, height])
            const pageInfo = result.formats?.chunks?.page_info
            if (pageInfo) {
              for (const [pageStr, info] of Object.entries(pageInfo)) {
                const pageNum = parseInt(pageStr, 10)
                if (info.bbox?.length === 4) {
                  pageDims.set(pageNum, [info.bbox[2], info.bbox[3]])
                }
              }
            }

            const { html: linkedHtml, linkCount } = injectLinks(
              processedContent,
              mappings,
              bboxMap,
              pageDims,
            )
            processedContent = linkedHtml
            event.linkCount = linkCount

            if (result.formats?.html) {
              result.formats.html = injectLinks(result.formats.html, mappings, bboxMap, pageDims).html
            }
          }
        } catch (err) {
          event.linkExtractionError = getErrorMessage(err)
        }
      }

      // Run TOC extraction and block filtering in parallel
      emitProgress?.({ stage: "Extracting table of contents", current: 0, total: 1 })
      emitProgress?.({ stage: "Filtering text blocks", current: 0, total: 1 })

      const textContent = result.formats?.markdown || result.content || ""

      const [tocExtractResult, blockFilterResult] = await Promise.all([
        tryCatch(extractTableOfContents(textContent, pdfBuffer)),
        tryCatch(filterBlocksForTTS(normalizedChunks)),
      ])

      emitProgress?.({ stage: "Extracting table of contents", current: 1, total: 1 })
      emitProgress?.({ stage: "Filtering text blocks", current: 1, total: 1 })

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

      if (blockFilterResult.success) {
        blockFilter = blockFilterResult.data
      } else {
        console.warn("[jobs] Block filter failed:", blockFilterResult.error)
      }

      // Apply includeTts to normalized blocks
      for (const chunk of normalizedChunks) {
        chunk.includeTts = chunk.block_type.includes("SectionHeader")
          ? true
          : blockFilter?.[chunk.id] ?? false
      }
    } else {
      console.warn(
        "[jobs] Failed to read PDF for link extraction:",
        pdfReadResult.error,
      )
      event.tocStatus = "pdf_read_failed"
    }
  }

  // Inject page markers (parses page numbers from data-block-id attributes)
  try {
    const pageMarkerResult = injectPageMarkers(processedContent, pageOffset)
    processedContent = pageMarkerResult.html
    event.pageMarkersExpected = pageMarkerResult.stats.expected
    event.pageMarkersInjected = pageMarkerResult.stats.injected

    if (result.formats?.html) {
      result.formats.html = injectPageMarkers(
        result.formats.html,
        pageOffset,
      ).html
    }
  } catch (err) {
    event.pageMarkerError = getErrorMessage(err)
  }

  // Apply HTML enhancements (after page markers so tables wrap correctly)
  if (processedContent) {
    processedContent = processHtml(processedContent, HTML_TRANSFORMS)
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
      const chunksForPersistence = transformChunks(normalizedChunks)

      const persistResult = await tryCatch(
        persistDocument(convex, {
          fileId: fileInfo.fileId,
          filename: fileInfo.filename,
          pageCount: result.metadata?.pages,
          toc: tocResult ?? { sections: [], offset: 0 },
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

  return { content: processedContent, blocks: normalizedChunks, imageUrls, toc: tocResult, documentId }
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
