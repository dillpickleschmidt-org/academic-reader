import { Effect } from "effect"
import type { AppConfigShape } from "../config"
import type { StorageService } from "../services/storage"
import type { ConvexServerSession } from "../services/convex-client"
import type { DocumentLocation } from "../documents/document-storage"
import { contentHtmlKey, contentMarkdownKey, originalFileKey } from "../documents/document-storage"
import { saveDocumentImages } from "../documents/document-images"
import { processHtml, HTML_TRANSFORMS, rewriteImageSources, injectPageMarkers } from "../utils/html-processing"
import { extractAndInjectLinks } from "../services/link-extraction"
import { normalizeChunk, transformChunks } from "./chunk-normalizer"
import type { JobResultInput } from "./document-conversion"

const CHUNK_BATCH_SIZE = 200

export async function persistConversionResult(options: {
  config: AppConfigShape
  storage: StorageService
  convex: ConvexServerSession
  documentId: string
  location: DocumentLocation
  result: JobResultInput
}) {
  const imageUrls = options.result.images && Object.keys(options.result.images).length
    ? await Effect.runPromise(
        saveDocumentImages(options.storage, options.location, options.result.images),
      )
    : null
  const imageCount = imageUrls ? Object.keys(imageUrls).length : 0

  let processedContent = options.result.content
  if (imageUrls) {
    processedContent = rewriteImageSources(processedContent, imageUrls)
  }

  const rawChunks = (options.result.formats.chunks?.blocks ?? []) as any[]
  const normalizedChunks = rawChunks.map((block, index) =>
    normalizeChunk(block, index),
  )

  if (
    normalizedChunks.length &&
    options.config.conversionBackend === "datalab"
  ) {
    const pdfResult = await Effect.runPromiseExit(
      options.storage.readFile(originalFileKey(options.location)),
    )
    if (pdfResult._tag === "Success") {
      try {
        const linked = extractAndInjectLinks(pdfResult.value, processedContent)
        processedContent = linked.html
      } catch {}
    }
  }

  let pageMarkerStats = { expected: 0, injected: 0 }
  try {
    const pageMarkers = injectPageMarkers(processedContent, 0)
    processedContent = pageMarkers.html
    pageMarkerStats = pageMarkers.stats
  } catch {}

  let htmlProcessingStats = { katexFailureCount: 0 }
  if (processedContent) {
    const processed = processHtml(processedContent, HTML_TRANSFORMS)
    processedContent = processed.html
    htmlProcessingStats = processed.stats
  }

  const markdownContent = options.result.formats.markdown

  await Effect.runPromise(
    Effect.all(
      [
        options.storage.saveFile(contentHtmlKey(options.location), processedContent),
        options.storage.saveFile(
          contentMarkdownKey(options.location),
          markdownContent,
        ),
      ],
      { concurrency: "unbounded" },
    ),
  )

  const chunksForPersistence = transformChunks(normalizedChunks)
  for (let i = 0; i < chunksForPersistence.length; i += CHUNK_BATCH_SIZE) {
    await options.convex.addDocumentChunks(
      options.documentId,
      chunksForPersistence.slice(i, i + CHUNK_BATCH_SIZE),
    )
  }

  return {
    content: processedContent,
    blocks: normalizedChunks,
    imageCount,
    htmlLength: processedContent.length,
    markdownLength: markdownContent.length,
    pageMarkerStats,
    htmlProcessingStats,
  }
}
