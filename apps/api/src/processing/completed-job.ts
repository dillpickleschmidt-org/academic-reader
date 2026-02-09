import { Effect } from "effect"
import { ConvexHttpClient } from "convex/browser"
import { getToken } from "@convex-dev/better-auth/utils"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { enrichEvent, type WideEvent, emitStreamingEvent } from "../middleware/wide-event"
import {
  processHtml,
  HTML_TRANSFORMS,
  rewriteImageSources,
  injectPageMarkers,
} from "../utils/html-processing"
import { normalizeChunks, transformChunks, type ChunkBlock, type ChunkInput } from "./chunk-normalizer"
import { runBackgroundEnrichments } from "./enrichments"
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
    blocks?: Array<{ id?: string, block_type?: string, html?: string, label?: string, content?: string, bbox: number[], section_hierarchy?: Record<string, string> }>
    page_info?: Record<string, { bbox: number[], polygon: number[][] }>
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
    if (result.images && Object.keys(result.images).length > 0 && fileInfo?.documentPath) {
      const uploadResult = yield* Effect.either(storage.uploadImages(fileInfo.documentPath, result.images))
      if (uploadResult._tag === "Right") {
        imageUrls = uploadResult.right
        event.imageCount = Object.keys(imageUrls).length
      } else {
        event.error = { category: "storage", message: String(uploadResult.left), code: "IMAGE_UPLOAD_FAILED" }
      }
    }

    // Rewrite image sources
    let processedContent = result.content || ""
    if (imageUrls && processedContent) {
      processedContent = rewriteImageSources(processedContent, imageUrls)
    }

    const rawChunks = (result.formats?.chunks?.blocks ?? []) as any[]
    const normalizedChunks = normalizeChunks(rawChunks)
    event.chunkCount = normalizedChunks.length

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
      yield* Effect.all([
        storage.saveFile(`${fileInfo.documentPath}/content.html`, result.formats.html || ""),
        storage.saveFile(`${fileInfo.documentPath}/content.md`, result.formats.markdown || ""),
      ], { concurrency: "unbounded" }).pipe(Effect.ignore)
    }

    // Persist to Convex
    let documentId: string | undefined
    if (fileInfo) {
      const convex = yield* createConvexClient(config, requestCookies)
      if (convex) {
        const chunksForPersistence = transformChunks(normalizedChunks)
        const persistResult = yield* Effect.tryPromise({
          try: () => persistDocument(convex, fileInfo, result, chunksForPersistence),
          catch: (e) => e,
        }).pipe(Effect.either)

        if (persistResult._tag === "Right") {
          documentId = persistResult.right
          event.documentId = documentId

          // Fire-and-forget enrichments
          if (normalizedChunks.length && fileInfo.documentPath) {
            Effect.runFork(runBackgroundEnrichments(normalizedChunks, documentId, convex))
          }
        }
      }
    }

    return { content: processedContent, blocks: normalizedChunks, imageUrls, documentId } satisfies ProcessedJobResult
  })
}

function createConvexClient(config: { convex: { httpUrl: string, siteUrl: string } }, cookies: Record<string, string>) {
  return Effect.tryPromise({
    try: async () => {
      const headers = new Headers()
      const cookieStr = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
      if (cookieStr) headers.set("Cookie", cookieStr)

      const { token } = await getToken(config.convex.httpUrl, headers)
      if (!token) return null

      const client = new ConvexHttpClient(config.convex.siteUrl)
      client.setAuth(token)
      return client
    },
    catch: () => null as never,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
}

async function persistDocument(
  convex: ConvexHttpClient,
  fileInfo: JobFileEntry,
  result: JobResultInput,
  chunks: ChunkInput[],
): Promise<string> {
  const { documentId } = await convex.mutation("api/documents:create" as any, {
    filename: fileInfo.filename ?? "document.pdf",
    storageId: fileInfo.fileId,
    pageCount: result.metadata?.pages,
  })

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
    await convex.mutation("api/documents:addChunks" as any, {
      documentId,
      chunks: batch,
    })
  }

  return documentId
}

