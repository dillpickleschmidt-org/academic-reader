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
import { rewriteBlocksForTTS } from "../../services/tts-rewrite"
import { generateDocumentSummary } from "../../services/summary-generation"
import { stripHtml } from "../../utils/sanitize"
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
import { createWideEvent, emitEvent } from "../../utils/wide-event-logger"
import { env } from "../../env"
import { createAuthenticatedConvexClient } from "../../services/convex"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
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
  bbox: number[]
  section_hierarchy?: Record<string, string>
}

/** CHANDRA chunk format */
interface ChandraChunkBlock {
  label: string
  content: string
  bbox: number[]
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
      bbox: block.bbox,
      polygon: [],
      section_hierarchy: block.section_hierarchy,
    }
  }
  return {
    id: `chandra-${index}`,
    block_type: block.label,
    html: block.content,
    bbox: block.bbox,
    polygon: [],
  }
}

function transformChunks(chunks: ChunkBlock[]): ChunkInput[] {
  return chunks
    .filter((chunk) => chunk.html.trim().length > 0)
    .map((chunk) => ({
      blockId: chunk.id,
      blockType: chunk.block_type,
      html: chunk.html,
      section: chunk.section_hierarchy
        ? Object.values(chunk.section_hierarchy).filter(Boolean).join(" > ")
        : undefined,
      bbox: chunk.bbox,
      includeTts: chunk.includeTts,
    }))
}

/**
 * Process a completed job: upload images, rewrite URLs, save to S3, persist to Convex.
 * TOC extraction and TTS filtering are deferred to background processing.
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

  const rawChunks = result.formats?.chunks?.blocks ?? []
  const normalizedChunks = rawChunks.map((block, index) =>
    normalizeChunk(block, index),
  )
  event.chunkCount = normalizedChunks.length

  // Extract and inject PDF links (datalab only, synchronous)
  if (normalizedChunks.length && fileInfo?.documentPath && event.backend === "datalab") {
    const pdfReadResult = await tryCatch(
      storage.readFile(`${fileInfo.documentPath}/original.pdf`),
    )

    if (pdfReadResult.success) {
      try {
        const mappings = extractLinkMappings(pdfReadResult.data)
        if (mappings.length) {
          const bboxMap: BboxMap = new Map()
          const pageDims: PageDimensions = new Map()

          for (const chunk of normalizedChunks) {
            if (chunk.bbox.length === 4) {
              bboxMap.set(chunk.id, chunk.bbox as [number, number, number, number])
            }
          }

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
  }

  // Inject page markers with offset=0 (corrected client-side when TOC arrives)
  try {
    const pageMarkerResult = injectPageMarkers(processedContent, 0)
    processedContent = pageMarkerResult.html
    event.pageMarkersExpected = pageMarkerResult.stats.expected
    event.pageMarkersInjected = pageMarkerResult.stats.injected

    if (result.formats?.html) {
      result.formats.html = injectPageMarkers(result.formats.html, 0).html
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

  // Persist to Convex (without TOC, without includeTts)
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
          chunks: chunksForPersistence,
        }),
      )

      if (persistResult.success) {
        documentId = persistResult.data
        event.documentId = documentId

        // Fire-and-forget background enrichments (TOC + TTS)
        if (normalizedChunks.length && fileInfo.documentPath) {
          processEnrichments(
            storage,
            fileInfo,
            result,
            normalizedChunks,
            documentId,
            convex,
          ).catch((err) =>
            console.warn("[jobs] Background enrichment failed:", err),
          )
        }
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

  return { content: processedContent, blocks: normalizedChunks, imageUrls, documentId }
}

const TTS_BATCH_SIZE = 200

async function writePlainTtsText(
  convex: import("convex/browser").ConvexHttpClient,
  documentId: Id<"documents">,
  chunks: ChunkBlock[],
) {
  const texts = chunks
    .map((c) => ({ blockId: c.id, ttsText: stripHtml(c.html) }))
    .filter((t) => t.ttsText.length > 0)

  for (let i = 0; i < texts.length; i += TTS_BATCH_SIZE) {
    await tryCatch(
      convex.mutation(api.api.documents.updateChunksTtsText, {
        documentId,
        texts: texts.slice(i, i + TTS_BATCH_SIZE),
      }),
    )
  }
}

/**
 * Background enrichment: extract TOC, filter TTS blocks, and generate summary.
 * Runs asynchronously after the document is persisted and SSE completed is sent.
 */
async function processEnrichments(
  storage: Storage,
  fileInfo: FileInfo,
  result: JobResultInput,
  normalizedChunks: ChunkBlock[],
  documentId: string,
  convex: import("convex/browser").ConvexHttpClient,
) {
  const start = performance.now()
  const typedDocumentId = documentId as Id<"documents">
  const chunkHtml = normalizedChunks.map((c) => c.html).join("\n")
  const errors: string[] = []

  const pdfReadResult = await tryCatch(
    storage.readFile(`${fileInfo.documentPath}/original.pdf`),
  )

  if (!pdfReadResult.success) {
    errors.push(`PDF read failed: ${getErrorMessage(pdfReadResult.error)}`)
    // Fallback: set empty TOC, all blocks TTS-included, still generate summary
    const summaryResult = await tryCatch(generateDocumentSummary(chunkHtml))
    if (!summaryResult.success) errors.push(`Summary failed: ${getErrorMessage(summaryResult.error)}`)
    await Promise.all([
      tryCatch(
        convex.mutation(api.api.documents.updateToc, {
          documentId: typedDocumentId,
          toc: { sections: [], offset: 0 },
        }),
      ),
      tryCatch(
        convex.mutation(api.api.documents.updateSummary, {
          documentId: typedDocumentId,
          summary: summaryResult.success ? summaryResult.data : "",
        }),
      ),
    ])
    const allTtsFlags = normalizedChunks.map((c) => ({ blockId: c.id, includeTts: true }))
    for (let i = 0; i < allTtsFlags.length; i += TTS_BATCH_SIZE) {
      await tryCatch(
        convex.mutation(api.api.documents.updateChunksTtsFlags, {
          documentId: typedDocumentId,
          flags: allTtsFlags.slice(i, i + TTS_BATCH_SIZE),
        }),
      )
    }
    await writePlainTtsText(convex, typedDocumentId, normalizedChunks)
    emitEnrichmentEvent(documentId, start, errors)
    return
  }

  const pdfBuffer = pdfReadResult.data
  const textContent = result.formats?.markdown || result.content || ""

  // Run TOC extraction, TTS filter, and summary generation in parallel
  const [tocExtractResult, filterResult, summaryResult] = await Promise.all([
    tryCatch(extractTableOfContents(textContent, pdfBuffer)),
    tryCatch(filterBlocksForTTS(normalizedChunks)),
    tryCatch(generateDocumentSummary(chunkHtml)),
  ])

  // Run TTS rewrite sequentially (depends on filter result for eligible blocks)
  const rewriteResult = filterResult.success
    ? await tryCatch(
        rewriteBlocksForTTS(
          normalizedChunks.filter((c) => filterResult.data[c.id] !== false),
        ),
      )
    : { success: false as const, error: filterResult.error }

  // Update TOC (always, even on failure)
  let tocResult: TocResult = { sections: [], offset: 0 }
  if (tocExtractResult.success && tocExtractResult.data.toc) {
    tocResult = tocExtractResult.data.toc
  } else if (!tocExtractResult.success) {
    errors.push(`TOC extraction failed: ${getErrorMessage(tocExtractResult.error)}`)
  }
  await tryCatch(
    convex.mutation(api.api.documents.updateToc, {
      documentId: typedDocumentId,
      toc: tocResult,
    }),
  )

  // Update TTS flags (uses filter result even if rewrite failed)
  if (filterResult.success) {
    const filterMap = filterResult.data
    const ttsFlags = normalizedChunks.map((chunk) => ({
      blockId: chunk.id,
      includeTts: filterMap[chunk.id] ?? true,
    }))

    for (let i = 0; i < ttsFlags.length; i += TTS_BATCH_SIZE) {
      await tryCatch(
        convex.mutation(api.api.documents.updateChunksTtsFlags, {
          documentId: typedDocumentId,
          flags: ttsFlags.slice(i, i + TTS_BATCH_SIZE),
        }),
      )
    }
  } else {
    errors.push(`TTS filter failed: ${getErrorMessage(filterResult.error)}`)
    const allTtsFlags = normalizedChunks.map((c) => ({ blockId: c.id, includeTts: true }))
    for (let i = 0; i < allTtsFlags.length; i += TTS_BATCH_SIZE) {
      await tryCatch(
        convex.mutation(api.api.documents.updateChunksTtsFlags, {
          documentId: typedDocumentId,
          flags: allTtsFlags.slice(i, i + TTS_BATCH_SIZE),
        }),
      )
    }
  }

  // Update TTS text (rewrite result or plain text fallback)
  if (rewriteResult.success) {
    if (rewriteResult.data.failedGroups > 0) {
      errors.push(`TTS rewrite: ${rewriteResult.data.failedGroups} group(s) fell back to plain text`)
    }

    const ttsTexts = Object.entries(rewriteResult.data.texts).map(([blockId, ttsText]) => ({
      blockId,
      ttsText,
    }))

    for (let i = 0; i < ttsTexts.length; i += TTS_BATCH_SIZE) {
      const batch = ttsTexts.slice(i, i + TTS_BATCH_SIZE)
      const batchResult = await tryCatch(
        convex.mutation(api.api.documents.updateChunksTtsText, {
          documentId: typedDocumentId,
          texts: batch,
        }),
      )
      if (!batchResult.success) {
        errors.push(`ttsText batch ${i / TTS_BATCH_SIZE + 1} failed: ${getErrorMessage(batchResult.error)}`)
      }
    }
  } else {
    errors.push(`TTS rewrite failed: ${getErrorMessage(rewriteResult.error)}`)
    await writePlainTtsText(convex, typedDocumentId, normalizedChunks)
  }

  // Update summary (always, even on failure — default to empty string)
  if (!summaryResult.success) {
    errors.push(`Summary failed: ${getErrorMessage(summaryResult.error)}`)
  }
  await tryCatch(
    convex.mutation(api.api.documents.updateSummary, {
      documentId: typedDocumentId,
      summary: summaryResult.success ? summaryResult.data : "",
    }),
  )

  emitEnrichmentEvent(documentId, start, errors)
}

function emitEnrichmentEvent(documentId: string, start: number, errors: string[]) {
  const event = createWideEvent("BACKGROUND", "/enrichment", {
    backendMode: env.BACKEND_MODE,
    siteUrl: env.SITE_URL,
  })
  event.documentId = documentId
  event.durationMs = Math.round(performance.now() - start)
  event.status = errors.length > 0 ? 500 : 200
  if (errors.length > 0) {
    event.error = {
      category: "backend",
      message: errors.join("; "),
      code: "ENRICHMENT_PARTIAL_FAILURE",
    }
  }
  emitEvent(event)
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
