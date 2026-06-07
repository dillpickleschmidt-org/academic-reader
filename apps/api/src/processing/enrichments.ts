import { Cause, Effect, Option } from "effect"
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
import {
  filterBlocksForTTS,
  getTtsBlockFilterErrorDetails,
} from "../services/ai/tts-block-filter"
import {
  rewriteBlocksForTTS,
  getTtsRewriteErrorDetails,
} from "../services/ai/tts-rewrite"
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
            status: 500,
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
          const failure = Option.getOrUndefined(Cause.failureOption(cause))
          emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/tts"), {
            status: 500,
            ...getTtsBlockFilterErrorDetails(failure),
            ...getTtsRewriteErrorDetails(failure),
            error: {
              category: "internal",
              message: Cause.pretty(cause),
              code: "TTS_ENRICHMENT_FAILED",
            },
          })
          return Effect.void
        }),
      ),
      summaryEnrichment(chunkHtml, documentId, convex, ctx).pipe(
        Effect.catchAllCause((cause) => {
          emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/summary"), {
            status: 500,
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
        status: 200,
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
      status: 200,
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
    const filterMap = yield* filterBlocksForTTS(chunks)
    const includedChunks = chunks.filter((c) => filterMap[c.id] === true)

    const rewriteResult = yield* rewriteBlocksForTTS(includedChunks)
    const textByBlockId = new Map(Object.entries(rewriteResult.texts))

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
      status: 200,
      durationMs: Date.now() - start,
      totalChunks: chunks.length,
      includedChunks: includedChunks.length,
      rewrittenChunks: textByBlockId.size,
      repairedRewriteBlocks: rewriteResult.repairedBlocks,
      firstRewrittenChars: firstRewrittenChars(textByBlockId),
    })

    if (ctx.audioVoiceId && config.ttsBackend !== "none") {
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const result = startDocumentAudioGeneration({
        convex: serverConvex,
        storage,
        ttsService,
        documentId,
        voiceId: ctx.audioVoiceId,
        ttsBackend: config.ttsBackend,
        documentPath,
        event: {
          ...enrichmentEvent(ctx, "/enrichment/audio-generation"),
          voiceId: ctx.audioVoiceId,
        },
      })
      emitStreamingEvent(enrichmentEvent(ctx, "/enrichment/audio"), {
        status: result.started ? 202 : 200,
        ...result,
      })
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
      status: 200,
      durationMs: Date.now() - start,
      summaryLength: summary.length,
    })
  })
}

function firstRewrittenChars(textByBlockId: Map<string, string>) {
  return Array.from(textByBlockId.values()).find((text) => text.trim())
    ?.trim()
    .slice(0, 10)
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
