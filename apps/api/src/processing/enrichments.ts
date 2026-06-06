import { Effect } from "effect"
import { stripHtml } from "../utils/sanitize"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { TtsService } from "../services/backends/tts"
import {
  createConvexServerSession,
  type ConvexSession,
  type DocumentToc,
  type TtsChunkPreparation,
} from "../services/convex-client"
import { startDocumentAudioGeneration } from "../services/tts-generation"
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
  audioVoiceId?: string
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
  convex: ConvexSession,
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
      ttsEnrichment(chunks, documentId, documentPath, ctx).pipe(
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
  convex: ConvexSession,
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
  documentPath: string,
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

    const rewriteResult = yield* rewriteBlocksForTTS(includedChunks).pipe(
      Effect.either,
    )

    const textByBlockId = new Map<string, string>()
    let failedGroups = 0
    let fallbackBlockCount = 0

    if (rewriteResult._tag === "Right") {
      failedGroups = rewriteResult.right.failedGroups
      fallbackBlockCount = rewriteResult.right.fallbackBlockCount
      for (const chunk of includedChunks) {
        textByBlockId.set(
          chunk.id,
          rewriteResult.right.texts[chunk.id] || stripHtml(chunk.html),
        )
      }
    } else {
      for (const chunk of includedChunks) {
        textByBlockId.set(chunk.id, stripHtml(chunk.html))
      }
    }

    const preparations: TtsChunkPreparation[] = chunks.map((chunk) => {
      if (filterMap[chunk.id] !== true) {
        return { blockId: chunk.id, includeTts: false, ttsText: null }
      }

      const ttsText = textByBlockId.get(chunk.id)?.trim()
      if (!ttsText) {
        return { blockId: chunk.id, includeTts: false, ttsText: null }
      }

      return {
        blockId: chunk.id,
        includeTts: true,
        ttsText,
      }
    })

    const config = yield* AppConfig
    const serverConvex = createConvexServerSession(config.convex)

    for (let i = 0; i < preparations.length; i += TTS_BATCH_SIZE) {
      yield* Effect.tryPromise({
        try: () =>
          serverConvex.setTtsChunkPreparation(
            documentId,
            preparations.slice(i, i + TTS_BATCH_SIZE),
          ),
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

    if (ctx.audioVoiceId) {
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const result = startDocumentAudioGeneration({
        convex: serverConvex,
        storage,
        ttsService,
        documentId,
        voiceId: ctx.audioVoiceId,
        backendMode: config.backendMode,
        documentPath,
      })
      emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/audio"), result)
    }
  })
}

function summaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexSession,
  ctx: EnrichmentContext,
) {
  return Effect.gen(function* () {
    const start = Date.now()
    const summary = yield* generateDocumentSummary(chunkHtml)

    yield* Effect.tryPromise({
      try: () => convex.updateDocumentSummary(documentId, summary),
      catch: (e) => e as Error,
    })

    emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/summary"), {
      durationMs: Date.now() - start,
      summaryLength: summary.length,
    })
  })
}

function persistToc(
  convex: ConvexSession,
  documentId: string,
  toc: DocumentToc,
) {
  return Effect.tryPromise({
    try: () => convex.updateDocumentToc(documentId, toc),
    catch: (e) => e as Error,
  })
}
