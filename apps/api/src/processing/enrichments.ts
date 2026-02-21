import { Effect } from "effect"
import type { ConvexHttpClient } from "convex/browser"
import { stripHtml } from "../utils/sanitize"
import { Storage } from "../services/storage"
import { extractTableOfContents } from "../services/ai/toc-extraction"
import { filterBlocksForTTS } from "../services/ai/tts-block-filter"
import { rewriteBlocksForTTS } from "../services/ai/tts-rewrite"
import { generateDocumentSummary } from "../services/ai/summary-generation"
import {
  emitStreamingEvent,
  type WideEvent,
} from "../middleware/wide-event"
import type { ChunkBlock } from "./chunk-normalizer"

const TTS_BATCH_SIZE = 200

export interface EnrichmentContext {
  requestId: string
  documentId: string
  environment: string
  deployment: "dev" | "prod"
}

function enrichmentEvent(
  ctx: EnrichmentContext,
  path: string,
): WideEvent {
  return {
    requestId: ctx.requestId,
    timestamp: new Date().toISOString(),
    service: "academic-reader-api",
    version: "2.0.0",
    environment: ctx.environment,
    deployment: ctx.deployment,
    method: "BACKGROUND",
    path,
    documentId: ctx.documentId,
  }
}

export function runBackgroundEnrichments(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
  documentPath: string,
  textContent: string,
  ctx: EnrichmentContext,
) {
  const chunkHtml = chunks.map((c) => c.html).join("\n")

  return Effect.all(
    [
      tocEnrichment(documentId, convex, documentPath, textContent, ctx).pipe(
        Effect.catchAllCause((cause) => {
          emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/toc"), {
            error: {
              category: "internal",
              message: String(cause),
              code: "TOC_ENRICHMENT_FAILED",
            },
          })
          return Effect.void
        }),
      ),
      ttsEnrichment(chunks, documentId, convex, ctx).pipe(
        Effect.catchAllCause((cause) => {
          emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/tts"), {
            error: {
              category: "internal",
              message: String(cause),
              code: "TTS_ENRICHMENT_FAILED",
            },
          })
          return Effect.void
        }),
      ),
      summaryEnrichment(chunkHtml, documentId, convex, ctx).pipe(
        Effect.catchAllCause((cause) => {
          emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/summary"), {
            error: {
              category: "internal",
              message: String(cause),
              code: "SUMMARY_ENRICHMENT_FAILED",
            },
          })
          return Effect.void
        }),
      ),
    ],
    { concurrency: "unbounded" },
  )
}

function tocEnrichment(
  documentId: string,
  convex: ConvexHttpClient,
  documentPath: string,
  textContent: string,
  ctx: EnrichmentContext,
) {
  return Effect.gen(function* () {
    const start = Date.now()
    const storage = yield* Storage
    const pdfResult = yield* storage
      .readFile(`${documentPath}/original.pdf`)
      .pipe(Effect.either)

    const pdfReadable = pdfResult._tag === "Right"

    if (!pdfReadable) {
      yield* persistToc(convex, documentId, { sections: [], offset: 0 })
      emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/toc"), {
        durationMs: Date.now() - start,
        pdfReadable: false,
        tocSections: 0,
      })
      return
    }

    const result = yield* extractTableOfContents(textContent, pdfResult.right)
    const toc = result.toc ?? { sections: [], offset: 0 }
    yield* persistToc(convex, documentId, toc)

    emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/toc"), {
      durationMs: Date.now() - start,
      pdfReadable: true,
      tocSections: toc.sections.length,
    })
  })
}

function ttsEnrichment(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
  ctx: EnrichmentContext,
) {
  return Effect.gen(function* () {
    const start = Date.now()
    const filterResult = yield* filterBlocksForTTS(chunks).pipe(Effect.either)

    let filterMap: Record<string, boolean>
    let includedChunks: ChunkBlock[]
    let filterFailed = false

    if (filterResult._tag === "Right") {
      filterMap = filterResult.right
      includedChunks = chunks.filter((c) => filterMap[c.id] === true)
    } else {
      filterFailed = true
      filterMap = Object.fromEntries(chunks.map((c) => [c.id, true]))
      includedChunks = chunks
    }

    const allTtsFlags = chunks.map((c) => ({
      blockId: c.id,
      includeTts: filterMap[c.id] === true,
    }))
    for (let i = 0; i < allTtsFlags.length; i += TTS_BATCH_SIZE) {
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/documents:updateChunksTtsFlags" as any, {
            documentId,
            flags: allTtsFlags.slice(i, i + TTS_BATCH_SIZE),
          }),
        catch: (e) => e as Error,
      })
    }

    const rewriteResult = yield* rewriteBlocksForTTS(includedChunks).pipe(
      Effect.either,
    )

    let texts: { blockId: string; ttsText: string }[]
    let failedGroups = 0
    let fallbackBlockCount = 0

    if (rewriteResult._tag === "Right") {
      failedGroups = rewriteResult.right.failedGroups
      fallbackBlockCount = rewriteResult.right.fallbackBlockCount
      texts = includedChunks
        .map((c) => ({
          blockId: c.id,
          ttsText: rewriteResult.right.texts[c.id] || stripHtml(c.html),
        }))
        .filter((t) => t.ttsText.length > 0)
    } else {
      texts = includedChunks
        .map((c) => ({ blockId: c.id, ttsText: stripHtml(c.html) }))
        .filter((t) => t.ttsText.length > 0)
    }

    for (let i = 0; i < texts.length; i += TTS_BATCH_SIZE) {
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/documents:updateChunksTtsText" as any, {
            documentId,
            texts: texts.slice(i, i + TTS_BATCH_SIZE),
          }),
        catch: (e) => e as Error,
      })
    }

    emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/tts"), {
      durationMs: Date.now() - start,
      totalChunks: chunks.length,
      includedChunks: includedChunks.length,
      filterFailed,
      failedGroups,
      fallbackBlockCount,
    })
  })
}

function summaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexHttpClient,
  ctx: EnrichmentContext,
) {
  return Effect.gen(function* () {
    const start = Date.now()
    const summary = yield* generateDocumentSummary(chunkHtml)

    yield* Effect.tryPromise({
      try: () =>
        convex.mutation("api/documents:updateSummary" as any, {
          documentId,
          summary,
        }),
      catch: (e) => e as Error,
    })

    emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/summary"), {
      durationMs: Date.now() - start,
      summaryLength: summary.length,
    })
  })
}

function persistToc(
  convex: ConvexHttpClient,
  documentId: string,
  toc: { sections: any[]; offset: number },
) {
  return Effect.tryPromise({
    try: () =>
      convex.mutation("api/documents:updateToc" as any, {
        documentId,
        toc,
      }),
    catch: (e) => e as Error,
  })
}
