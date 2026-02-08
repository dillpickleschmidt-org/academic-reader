import { Effect } from "effect"
import type { ConvexHttpClient } from "convex/browser"
import { extractTableOfContents, type TocResult } from "../services/ai/toc-extraction"
import { filterBlocksForTTS } from "../services/ai/tts-block-filter"
import { rewriteBlocksForTTS } from "../services/ai/tts-rewrite"
import { generateDocumentSummary } from "../services/ai/summary-generation"
import { Storage } from "../services/storage"
import { ModelProvider } from "../services/model-provider"
import { stripHtml } from "../utils/sanitize"
import type { ChunkBlock } from "./chunk-normalizer"
import type { JobResultInput } from "./completed-job"
import type { JobFileEntry } from "../services/job-file-map"

const TTS_BATCH_SIZE = 200

export function runBackgroundEnrichments(
  storage: any,
  config: any,
  fileInfo: JobFileEntry,
  result: JobResultInput,
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
) {
  const chunkHtml = chunks.map((c) => c.html).join("\n")

  Promise.resolve().then(async () => {
    try {
      // Run TOC, TTS, and summary enrichments
      const [tocResult, ttsFilterResult, summaryResult] = await Promise.allSettled([
        runTocEnrichment(storage, fileInfo, result, documentId, convex),
        runTtsEnrichment(chunks, documentId, convex),
        runSummaryEnrichment(chunkHtml, documentId, convex),
      ])

      if (tocResult.status === "rejected") {
        console.warn("[enrichments] TOC enrichment failed:", tocResult.reason)
      }
      if (ttsFilterResult.status === "rejected") {
        console.warn("[enrichments] TTS enrichment failed:", ttsFilterResult.reason)
      }
      if (summaryResult.status === "rejected") {
        console.warn("[enrichments] Summary enrichment failed:", summaryResult.reason)
      }
    } catch (err) {
      console.warn("[enrichments] Background enrichments failed:", err)
    }
  })
}

async function runTocEnrichment(
  _storage: any,
  fileInfo: JobFileEntry,
  result: JobResultInput,
  documentId: string,
  convex: ConvexHttpClient,
) {
  // For now, persist default empty TOC
  // Full TOC extraction with PDF + LLM requires reading the PDF from storage
  await convex.mutation("api/documents:updateToc" as any, {
    documentId,
    toc: { sections: [], offset: 0 },
  })
}

async function runTtsEnrichment(
  chunks: ChunkBlock[],
  documentId: string,
  convex: ConvexHttpClient,
) {
  // Persist default TTS flags (all included)
  const allTtsFlags = chunks.map((c) => ({ blockId: c.id, includeTts: true }))
  for (let i = 0; i < allTtsFlags.length; i += TTS_BATCH_SIZE) {
    await convex.mutation("api/documents:updateChunksTtsFlags" as any, {
      documentId,
      flags: allTtsFlags.slice(i, i + TTS_BATCH_SIZE),
    })
  }

  // Persist plain TTS text
  const texts = chunks
    .map((c) => ({ blockId: c.id, ttsText: stripHtml(c.html) }))
    .filter((t) => t.ttsText.length > 0)
  for (let i = 0; i < texts.length; i += TTS_BATCH_SIZE) {
    await convex.mutation("api/documents:updateChunksTtsText" as any, {
      documentId,
      texts: texts.slice(i, i + TTS_BATCH_SIZE),
    })
  }
}

async function runSummaryEnrichment(
  chunkHtml: string,
  documentId: string,
  convex: ConvexHttpClient,
) {
  // Persist empty summary for now
  await convex.mutation("api/documents:updateSummary" as any, {
    documentId,
    summary: "",
  })
}
