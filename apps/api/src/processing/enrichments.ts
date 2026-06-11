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
const EMPTY_TOC: DocumentToc = { sections: [], offset: 0 }

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
      .pipe(Effect.result)

    if (pdfResult._tag === "Failure") {
      yield* persistToc(convex, documentId, EMPTY_TOC)
      return tocStats(EMPTY_TOC, "pdf_read_failed", false)
    }

    const result = yield* extractTableOfContents(textContent, pdfResult.success)
    const toc = result.toc ?? EMPTY_TOC
    yield* persistToc(convex, documentId, toc)
    return tocStats(toc, result.meta.status, result.meta.offsetDetected)
  })
}

export function prepareTtsChunks(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexServerSession,
) {
  return Effect.gen(function* () {
    const filterResult = yield* filterBlocksForTTS(chunks)
    const filterMap = filterResult.map
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

    const preparedBlocks = preparations.filter((p) => p.includeTts).length
    return {
      ttsTotalBlocks: chunks.length,
      ttsFilterCandidateBlocks: filterResult.candidateBlocks,
      ttsFilterSkippedBeforeLlm: chunks.length - filterResult.candidateBlocks,
      ttsFilterBatches: filterResult.batches,
      ttsIncludedBlocks: includedChunks.length,
      ttsPreparedBlocks: preparedBlocks,
      ttsSkippedBlocks: chunks.length - preparedBlocks,
      ttsRewrittenBlocks: Object.keys(rewriteResult.texts).length,
      ttsRepairedBlocks: rewriteResult.repairedBlocks,
      ttsPreparationBatches: Math.ceil(preparations.length / TTS_BATCH_SIZE),
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

    return {
      summaryInputChars: chunkHtml.length,
      summaryChars: summary.length,
    }
  })
}

function tocStats(toc: DocumentToc, status: string, offsetDetected: boolean) {
  return {
    tocStatus: status,
    tocSectionCount: toc.sections.length,
    tocChildSectionCount: toc.sections.reduce(
      (sum, section) => sum + (section.children?.length ?? 0),
      0,
    ),
    tocOffset: toc.offset,
    tocOffsetDetected: offsetDetected,
    tocHasRomanNumerals: toc.hasRomanNumerals ?? false,
  }
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
