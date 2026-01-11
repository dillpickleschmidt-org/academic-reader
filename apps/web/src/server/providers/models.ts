/**
 * Model provider abstraction for easy swapping between providers.
 * Currently supports Google (Gemini), designed for easy OpenRouter addition.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"

export type ChatProvider = "google" | "openrouter"

interface ModelConfig {
  provider: ChatProvider
  chatModel: string
  embeddingModel: string
}

function getConfig(): ModelConfig {
  const provider = (process.env.AI_PROVIDER as ChatProvider) || "google"

  if (provider === "openrouter") {
    return {
      provider: "openrouter",
      chatModel: process.env.OPENROUTER_MODEL || "moonshotai/kimi-k2",
      // OpenRouter doesn't support embeddings - always use Google
      embeddingModel: "text-embedding-004",
    }
  }

  return {
    provider: "google",
    chatModel: process.env.GOOGLE_CHAT_MODEL || "gemini-3-flash-preview",
    embeddingModel: "text-embedding-004",
  }
}

/**
 * Create a chat model instance.
 * Defaults to Google Gemini, can be switched to OpenRouter via AI_PROVIDER env var.
 */
export function createChatModel(): LanguageModel {
  const config = getConfig()
  const apiKey = process.env.GOOGLE_API_KEY

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required")
  }

  if (config.provider === "openrouter") {
    // OpenRouter support - uncomment when needed:
    // import { createOpenAI } from "@ai-sdk/openai"
    // const openrouter = createOpenAI({
    //   apiKey: process.env.OPENROUTER_API_KEY,
    //   baseURL: "https://openrouter.ai/api/v1",
    // })
    // return openrouter(config.chatModel)

    // For now, fall back to Google
    const google = createGoogleGenerativeAI({ apiKey })
    return google(config.chatModel)
  }

  const google = createGoogleGenerativeAI({ apiKey })
  return google(config.chatModel)
}

/**
 * Create an embedding model instance.
 * Always uses Google text-embedding-004 (768 dimensions).
 */
export function createEmbeddingModel() {
  const apiKey = process.env.GOOGLE_API_KEY

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required for embeddings")
  }

  const google = createGoogleGenerativeAI({ apiKey })
  return google.textEmbeddingModel("text-embedding-004")
}

/**
 * Get the current model configuration (for logging/debugging).
 */
export function getModelConfig(): ModelConfig {
  return getConfig()
}
