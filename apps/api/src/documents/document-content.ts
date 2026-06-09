import { Effect } from "effect"
import type { ConvexSession } from "../services/convex-client"
import type { StorageService } from "../services/storage"
import { contentHtmlKey, contentMarkdownKey, documentLocation } from "./document-storage"

export function loadDocumentContent(
  storage: StorageService,
  convex: ConvexSession,
  documentId: string,
) {
  return Effect.gen(function* () {
    const doc = yield* Effect.tryPromise({
      try: () => convex.getDocument(documentId),
      catch: (e) => e as Error,
    })
    const location = documentLocation(doc, documentId)
    const [html, markdown, chunks] = yield* Effect.all(
      [
        storage
          .readFileAsString(contentHtmlKey(location))
          .pipe(Effect.mapError(() => new Error("Document content not found"))),
        storage
          .readFileAsString(contentMarkdownKey(location))
          .pipe(Effect.mapError(() => new Error("Document markdown not found"))),
        Effect.tryPromise({
          try: () => convex.getDocumentChunks(documentId),
          catch: (e) => e as Error,
        }),
      ],
      { concurrency: "unbounded" },
    )

    return {
      html,
      markdown,
      toc: doc.toc,
      chunks: chunks.map((chunk) => ({
        id: chunk.blockId,
        block_type: chunk.blockType,
        html: chunk.html,
        polygon: [] as number[][],
        bbox: chunk.bbox,
        includeTts: chunk.includeTts,
        ttsText: chunk.ttsText,
        order: chunk.order,
      })),
    }
  })
}
