import { Effect } from "effect"
import { embed, embedMany } from "ai"
import { ModelProvider } from "../model-provider"

export function generateEmbedding(
  text: string,
): Effect.Effect<number[], never, ModelProvider> {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const model = models.embeddingModel()

    const { embedding } = yield* Effect.tryPromise({
      try: () =>
        embed({
          model,
          value: text.replace(/\n/g, " ").trim(),
        }),
      catch: (e) =>
        new Error(
          `Embedding failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
    }).pipe(Effect.orDie)

    return embedding
  })
}

export function generateEmbeddings(
  texts: string[],
): Effect.Effect<number[][], never, ModelProvider> {
  return Effect.gen(function* () {
    if (texts.length === 0) return []

    const models = yield* ModelProvider
    const model = models.embeddingModel()
    const BATCH_SIZE = 100

    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const cleanedBatch = batch.map((t) => t.replace(/\n/g, " ").trim())

      const { embeddings } = yield* Effect.tryPromise({
        try: () =>
          embedMany({
            model,
            values: cleanedBatch,
          }),
        catch: (e) =>
          new Error(
            `Batch embedding failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
      }).pipe(Effect.orDie)

      allEmbeddings.push(...embeddings)
    }

    return allEmbeddings
  })
}
