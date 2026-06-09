import { Effect } from "effect"
import { Storage } from "../services/storage"
import {
  type ConvexServerSession,
  type DocumentToc,
  type TtsChunkPreparation,
} from "../services/convex-client"
import { extractTableOfContents } from "../services/ai/toc-extraction"
import { filterBlocksForTTS } from "../services/ai/tts-block-filter"
import { rewriteBlocksForTTS } from "../services/ai/tts-rewrite"
import { generateDocumentSummary } from "../services/ai/summary-generation"
import type { ChunkBlock } from "./chunk-normalizer"

const TTS_BATCH_SIZE = 200

export function tocEnrichment(
  documentId: string,
  convex: ConvexServerSession,
  originalFilePath: string,
  textContent: string,
) {
  return Effect.gen(function* () {
    const storage = yield* Storage
    const pdfResult = yield* storage
      .readFile(originalFilePath)
      .pipe(Effect.either)

    if (pdfResult._tag === "Left") {
      yield* persistToc(convex, documentId, { sections: [], offset: 0 })
      return
    }

    const result = yield* extractTableOfContents(textContent, pdfResult.right)
    yield* persistToc(convex, documentId, result.toc ?? { sections: [], offset: 0 })
  })
}

export function prepareTtsChunks(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexServerSession,
) {
  return Effect.gen(function* () {
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

    for (let i = 0; i < preparations.length; i += TTS_BATCH_SIZE) {
      yield* Effect.tryPromise({
        try: () =>
          convex.setTtsChunkPreparation(
            documentId,
            preparations.slice(i, i + TTS_BATCH_SIZE),
          ),
        catch: (e) => e as Error,
      })
    }
  })
}

export function summaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexServerSession,
) {
  return Effect.gen(function* () {
    const summary = yield* generateDocumentSummary(chunkHtml)

    yield* Effect.tryPromise({
      try: () => convex.updateDocumentSummary(documentId, summary),
      catch: (e) => e as Error,
    })
  })
}

function persistToc(
  convex: ConvexServerSession,
  documentId: string,
  toc: DocumentToc,
) {
  return Effect.tryPromise({
    try: () => convex.updateDocumentToc(documentId, toc),
    catch: (e) => e as Error,
  })
}
