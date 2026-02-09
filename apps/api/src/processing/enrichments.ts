import { Effect } from "effect"
import type { ConvexHttpClient } from "convex/browser"
import { stripHtml } from "../utils/sanitize"
import type { ChunkBlock } from "./chunk-normalizer"

const TTS_BATCH_SIZE = 200

export function runBackgroundEnrichments(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
) {
  const chunkHtml = chunks.map((c) => c.html).join("\n")

  return Effect.all([
    tocEnrichment(documentId, convex).pipe(Effect.catchAll((e) => {
      console.warn("[enrichments] TOC enrichment failed:", e)
      return Effect.void
    })),
    ttsEnrichment(chunks, documentId, convex).pipe(Effect.catchAll((e) => {
      console.warn("[enrichments] TTS enrichment failed:", e)
      return Effect.void
    })),
    summaryEnrichment(chunkHtml, documentId, convex).pipe(Effect.catchAll((e) => {
      console.warn("[enrichments] Summary enrichment failed:", e)
      return Effect.void
    })),
  ], { concurrency: "unbounded" })
}

function tocEnrichment(documentId: string, convex: ConvexHttpClient) {
  return Effect.tryPromise({
    try: () =>
      convex.mutation("api/documents:updateToc" as any, {
        documentId,
        toc: { sections: [], offset: 0 },
      }),
    catch: (e) => e as Error,
  })
}

function ttsEnrichment(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
) {
  return Effect.gen(function* () {
    const allTtsFlags = chunks.map((c) => ({ blockId: c.id, includeTts: true }))
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

    const texts = chunks
      .map((c) => ({ blockId: c.id, ttsText: stripHtml(c.html) }))
      .filter((t) => t.ttsText.length > 0)
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
  })
}

function summaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexHttpClient,
) {
  return Effect.tryPromise({
    try: () =>
      convex.mutation("api/documents:updateSummary" as any, {
        documentId,
        summary: "",
      }),
    catch: (e) => e as Error,
  })
}
