import { Effect } from "effect"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { ModelProvider } from "../services/model-provider"
import { TtsService } from "../services/backends/tts"
import {
  createConvexSessionFromCookies,
  type ConvexSession,
} from "../services/convex-client"
import type { WideEvent } from "../middleware/wide-event"
import {
  processHtml,
  HTML_TRANSFORMS,
  rewriteImageSources,
  injectPageMarkers,
} from "../utils/html-processing"
import {
  normalizeChunk,
  transformChunks,
  type ChunkBlock,
  type ChunkInput,
} from "./chunk-normalizer"
import { runBackgroundEnrichments } from "./enrichments"
import { extractAndInjectLinks } from "../services/link-extraction"
import type { JobFileEntry } from "../services/job-file-map"

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
} as const

export interface JobResultFormats {
  html?: string
  markdown?: string
  chunks?: {
    blocks?: Array<{
      id?: string
      block_type?: string
      html?: string
      label?: string
      content?: string
      bbox: number[]
      section_hierarchy?: Record<string, string>
    }>
    page_info?: Record<string, { bbox: number[]; polygon: number[][] }>
  }
}

export interface JobResultInput {
  content?: string
  metadata?: { pages?: number }
  formats?: JobResultFormats
  images?: Record<string, string>
}

export interface ProcessedJobResult {
  content: string
  blocks: ChunkBlock[]
  imageUrls?: Record<string, string>
  documentId?: string
}

const CHUNK_BATCH_SIZE = 200

export function processCompletedJob(
  _jobId: string,
  result: JobResultInput,
  fileInfo: JobFileEntry | undefined,
  event: WideEvent,
  requestCookies: Record<string, string>,
) {
  return Effect.gen(function* () {
    const config = yield* AppConfig
    const storage = yield* Storage

    // Upload images
    let imageUrls: Record<string, string> | undefined
    if (
      result.images &&
      Object.keys(result.images).length > 0 &&
      fileInfo?.documentPath
    ) {
      const uploadResult = yield* Effect.either(
        storage.uploadImages(fileInfo.documentPath, result.images),
      )
      if (uploadResult._tag === "Right") {
        imageUrls = uploadResult.right
        event.imageCount = Object.keys(imageUrls).length
      } else {
        event.error = {
          category: "storage",
          message: String(uploadResult.left),
          code: "IMAGE_UPLOAD_FAILED",
        }
      }
    }

    // Rewrite image sources
    let processedContent = result.content || ""
    if (imageUrls && processedContent) {
      processedContent = rewriteImageSources(processedContent, imageUrls)
    }

    const rawChunks = (result.formats?.chunks?.blocks ?? []) as any[]
    const normalizedChunks = rawChunks.map((block, index) =>
      normalizeChunk(block, index),
    )
    event.chunkCount = normalizedChunks.length

    // Extract and inject links from PDF (datalab only — Marker/CHANDRA preserve links correctly)
    if (
      normalizedChunks.length &&
      fileInfo?.documentPath &&
      config.conversionBackend === "datalab"
    ) {
      const pdfResult = yield* storage
        .readFile(`${fileInfo.documentPath}/original.pdf`)
        .pipe(Effect.either)
      if (pdfResult._tag === "Right") {
        try {
          const { html: linkedHtml, linkCount } = extractAndInjectLinks(
            pdfResult.right,
            processedContent,
          )
          processedContent = linkedHtml
          if (linkCount > 0) event.linkCount = linkCount
          if (result.formats?.html) {
            result.formats.html = extractAndInjectLinks(
              pdfResult.right,
              result.formats.html,
            ).html
          }
        } catch {}
      }
    }

    // Inject page markers with offset=0
    try {
      const pageMarkerResult = injectPageMarkers(processedContent, 0)
      processedContent = pageMarkerResult.html
      event.pageMarkersExpected = pageMarkerResult.stats.expected
      event.pageMarkersInjected = pageMarkerResult.stats.injected

      if (result.formats?.html) {
        result.formats.html = injectPageMarkers(result.formats.html, 0).html
      }
    } catch (err) {
      event.pageMarkerError = err instanceof Error ? err.message : String(err)
    }

    // Apply HTML enhancements
    if (processedContent) {
      processedContent = processHtml(processedContent, HTML_TRANSFORMS)
    }

    // Rewrite image sources in formats.html
    if (imageUrls && result.formats?.html) {
      result.formats.html = rewriteImageSources(result.formats.html, imageUrls)
    }

    // Save to S3
    if (result.formats && fileInfo?.documentPath) {
      yield* Effect.all(
        [
          storage.saveFile(
            `${fileInfo.documentPath}/content.html`,
            result.formats.html || "",
          ),
          storage.saveFile(
            `${fileInfo.documentPath}/content.md`,
            result.formats.markdown || "",
          ),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.ignore)
    }

    // Persist to Convex
    let documentId: string | undefined
    if (fileInfo) {
      const convex = yield* createConvexSessionFromCookies(
        config.convex,
        requestCookies,
      )
      if (convex) {
        const chunksForPersistence = transformChunks(normalizedChunks)
        const persistResult = yield* Effect.tryPromise({
          try: () =>
            persistDocument(convex, fileInfo, result, chunksForPersistence),
          catch: (e) => e,
        }).pipe(Effect.either)

        if (persistResult._tag === "Right") {
          documentId = persistResult.right
          event.documentId = documentId

          // Fire-and-forget enrichments
          if (normalizedChunks.length && fileInfo.documentPath) {
            const textContent = result.formats?.markdown || result.content || ""
            Effect.runFork(
              runBackgroundEnrichments(
                normalizedChunks,
                documentId,
                convex,
                fileInfo.documentPath,
                textContent,
                {
                  requestId: event.requestId,
                  documentId,
                  environment: event.environment,
                  deployment: event.deployment,
                  audioVoiceId: fileInfo.audioVoiceId,
                },
              ).pipe(
                Effect.provide(ModelProvider.Live),
                Effect.provide(TtsService.Live),
                Effect.provideService(AppConfig, config),
                Effect.provideService(Storage, storage),
              ),
            )
          }
        }
      }
    }

    return {
      content: processedContent,
      blocks: normalizedChunks,
      imageUrls,
      documentId,
    } satisfies ProcessedJobResult
  })
}

async function persistDocument(
  convex: ConvexSession,
  fileInfo: JobFileEntry,
  result: JobResultInput,
  chunks: ChunkInput[],
): Promise<string> {
  const { documentId } = await convex.createDocument({
    filename: fileInfo.filename ?? "document.pdf",
    storageId: fileInfo.fileId,
    pageCount: result.metadata?.pages ?? null,
    toc: null,
  })

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
    await convex.addDocumentChunks(documentId, batch)
  }

  return documentId
}
