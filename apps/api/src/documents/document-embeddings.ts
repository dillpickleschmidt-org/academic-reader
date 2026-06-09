import { Effect } from "effect"
import type { ConvexSession } from "../services/convex-client"
import { generateEmbeddings } from "../services/ai/embeddings"

export function generateDocumentEmbeddings(
  convex: ConvexSession,
  documentId: string,
) {
  return Effect.gen(function* () {
    const hasEmbeddings = yield* Effect.tryPromise({
      try: () => convex.hasDocumentEmbeddings(documentId),
      catch: () => new Error("Failed to check embeddings status"),
    })

    if (hasEmbeddings) {
      return { chunkCount: 0, alreadyHasEmbeddings: true }
    }

    const chunks = yield* Effect.tryPromise({
      try: () => convex.getDocumentChunks(documentId),
      catch: () => new Error("Failed to fetch document chunks"),
    })

    if (!chunks.length) throw new Error("No chunks found for document")

    const embeddings = yield* generateEmbeddings(chunks.map((c) => c.html))
    yield* Effect.tryPromise({
      try: () => convex.addDocumentEmbeddings(documentId, embeddings),
      catch: () => new Error("Failed to update embeddings"),
    })

    return { chunkCount: chunks.length }
  })
}
