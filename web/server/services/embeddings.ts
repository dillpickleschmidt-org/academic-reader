/**
 * Embedding service for generating vector embeddings.
 * Uses Google's gemini-embedding-001 model (3072 dimensions).
 */

import { embed, embedMany } from "ai"
import { createEmbeddingModel } from "../providers/models"

// Lazily initialize embedding model
let embeddingModel: ReturnType<typeof createEmbeddingModel> | null = null

function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = createEmbeddingModel()
  }
  return embeddingModel
}

/**
 * Generate embedding for a single text (used for search queries).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = getEmbeddingModel()
  const { embedding } = await embed({
    model,
    value: text.replace(/\n/g, " ").trim(),
  })
  return embedding
}

/**
 * Generate embeddings for multiple texts (used for document chunks).
 * Processes in batches to stay within API limits.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const model = getEmbeddingModel()
  const BATCH_SIZE = 100 // Google supports up to 2048, but smaller batches are more reliable

  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const cleanedBatch = batch.map((t) => t.replace(/\n/g, " ").trim())

    const { embeddings } = await embedMany({
      model,
      values: cleanedBatch,
    })

    allEmbeddings.push(...embeddings)
  }

  return allEmbeddings
}
