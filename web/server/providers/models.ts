import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { env } from "../env"

export type Provider = "google" | "openrouter"

function createModel(provider: Provider, model: string): LanguageModel {
  if (provider === "openrouter") {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY! })
    return openrouter.chat(model)
  }

  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
  return google(model)
}

export function createChatModel(): LanguageModel {
  return createModel(env.CHAT_PROVIDER, env.CHAT_MODEL)
}

export function createProcessingModel(): LanguageModel {
  return createModel(env.PROCESSING_PROVIDER, env.PROCESSING_MODEL)
}

/**
 * Create an embedding model instance.
 * Always uses Google gemini-embedding-001 (3072 dimensions).
 */
export function createEmbeddingModel() {
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
  return google.embeddingModel("gemini-embedding-001")
}
