import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"
import { ConvexClient } from "../services/convex-client"
import { generateEmbeddings } from "../services/ai/embeddings"

export const documentEmbeddingsRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/:documentId/embeddings",
    Effect.gen(function* () {
      yield* requireAuth
      const convexService = yield* ConvexClient
      const convex = yield* convexService.fromRequest()
      const params = yield* HttpRouter.params
      const documentId = params.documentId!

      yield* enrichEvent({ documentId } as Record<string, unknown>)

      // Check if already has embeddings
      const hasEmbeddings = yield* Effect.tryPromise({
        try: () =>
          convex.query("api/documents:hasEmbeddings" as any, { documentId }),
        catch: () => new Error("Failed to check embeddings status"),
      })

      if (hasEmbeddings) {
        return HttpServerResponse.unsafeJson({ chunkCount: 0, alreadyHasEmbeddings: true })
      }

      // Fetch chunks
      const rawChunks = yield* Effect.tryPromise({
        try: () =>
          convex.query("api/documents:getChunks" as any, { documentId }),
        catch: () => new Error("Failed to fetch document chunks"),
      })
      const chunks = rawChunks as unknown as { html: string }[]

      if (!chunks || chunks.length === 0) {
        return HttpServerResponse.unsafeJson(
          { error: "No chunks found for document" },
          { status: 404 },
        )
      }

      // Generate embeddings
      const embeddings = yield* generateEmbeddings(chunks.map((c) => c.html))

      // Persist
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/documents:addEmbeddings" as any, {
            documentId,
            embeddings,
          }),
        catch: () => new Error("Failed to update embeddings"),
      })

      return HttpServerResponse.unsafeJson({ chunkCount: chunks.length })
    }),
  ),
)
