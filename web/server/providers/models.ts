import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { env } from "../env"

export type Provider = "google" | "openrouter" | "groq"

function createModel(provider: Provider, model: string): LanguageModel {
  if (provider === "openrouter") {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY! })
    return openrouter.chat(model)
  }

  if (provider === "groq") {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY! })
    return groq(model)
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

export function createSummaryModel(): LanguageModel {
  return createModel(env.SUMMARY_PROVIDER, env.SUMMARY_MODEL)
}

/**
 * Create an embedding model instance.
 * Always uses Google gemini-embedding-001 (3072 dimensions).
 */
export function createEmbeddingModel() {
  const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
  return google.embeddingModel("gemini-embedding-001")
}
