import { Effect } from "effect"
import type { ConvexHttpClient } from "convex/browser"
import { stripHtml } from "../utils/sanitize"
import { Storage } from "../services/storage"
import { extractTableOfContents } from "../services/ai/toc-extraction"
import { filterBlocksForTTS } from "../services/ai/tts-block-filter"
import { rewriteBlocksForTTS } from "../services/ai/tts-rewrite"
import { generateDocumentSummary } from "../services/ai/summary-generation"
import type { ChunkBlock } from "./chunk-normalizer"

const TTS_BATCH_SIZE = 200

export function runBackgroundEnrichments(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
  documentPath: string,
  textContent: string,
) {
  const chunkHtml = chunks.map((c) => c.html).join("\n")

  return Effect.all(
    [
      tocEnrichment(documentId, convex, documentPath, textContent).pipe(
        Effect.catchAllCause((cause) => {
          console.warn("[enrichments] TOC enrichment failed:", cause)
          return Effect.void
        }),
      ),
      ttsEnrichment(chunks, documentId, convex).pipe(
        Effect.catchAllCause((cause) => {
          console.warn("[enrichments] TTS enrichment failed:", cause)
          return Effect.void
        }),
      ),
      summaryEnrichment(chunkHtml, documentId, convex).pipe(
        Effect.catchAllCause((cause) => {
          console.warn("[enrichments] Summary enrichment failed:", cause)
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
) {
  return Effect.gen(function* () {
    const storage = yield* Storage
    const pdfResult = yield* storage
      .readFile(`${documentPath}/original.pdf`)
      .pipe(Effect.either)

    if (pdfResult._tag === "Left") {
      console.warn("[enrichments] Failed to read PDF for TOC:", pdfResult.left)
      yield* persistToc(convex, documentId, { sections: [], offset: 0 })
      return
    }

    const result = yield* extractTableOfContents(textContent, pdfResult.right)

    if (result.toc) {
      yield* persistToc(convex, documentId, result.toc)
    } else {
      yield* persistToc(convex, documentId, { sections: [], offset: 0 })
    }
  })
}

function ttsEnrichment(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
) {
  return Effect.gen(function* () {
    const filterResult = yield* filterBlocksForTTS(chunks).pipe(Effect.either)

    let filterMap: Record<string, boolean>
    let includedChunks: ChunkBlock[]

    if (filterResult._tag === "Right") {
      filterMap = filterResult.right
      includedChunks = chunks.filter((c) => filterMap[c.id] === true)
    } else {
      console.warn("[enrichments] TTS filter failed, including all blocks")
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
    if (rewriteResult._tag === "Right") {
      texts = includedChunks
        .map((c) => ({
          blockId: c.id,
          ttsText: rewriteResult.right.texts[c.id] || stripHtml(c.html),
        }))
        .filter((t) => t.ttsText.length > 0)
    } else {
      console.warn("[enrichments] TTS rewrite failed, using plain text")
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
  })
}

function summaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexHttpClient,
) {
  return Effect.gen(function* () {
    const summary = yield* generateDocumentSummary(chunkHtml)

    yield* Effect.tryPromise({
      try: () =>
        convex.mutation("api/documents:updateSummary" as any, {
          documentId,
          summary,
        }),
      catch: (e) => e as Error,
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
