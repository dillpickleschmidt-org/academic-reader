import { Context, Effect, Layer } from "effect"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel, EmbeddingModel } from "ai"
import { AppConfig } from "../config"

export interface ModelProviderService {
  chatModel(): LanguageModel
  processingModel(): LanguageModel
  summaryModel(): LanguageModel
  embeddingModel(): EmbeddingModel
}

export class ModelProvider extends Context.Tag("ModelProvider")<ModelProvider, ModelProviderService>() {
  static Live = Layer.effect(
    ModelProvider,
    Effect.gen(function* () {
      const config = yield* AppConfig

      function createModel(provider: string, model: string): LanguageModel {
        if (provider === "openrouter") {
          const openrouter = createOpenRouter({ apiKey: config.ai.openrouterApiKey! })
          return openrouter.chat(model)
        }

        if (provider === "groq") {
          const groq = createGroq({ apiKey: config.ai.groqApiKey! })
          return groq(model)
        }

        const google = createGoogleGenerativeAI({ apiKey: config.ai.googleApiKey })
        return google(model)
      }

      return {
        chatModel: () => createModel(config.ai.chat.provider, config.ai.chat.model),
        processingModel: () => createModel(config.ai.processing.provider, config.ai.processing.model),
        summaryModel: () => createModel(config.ai.summary.provider, config.ai.summary.model),
        embeddingModel: () => {
          const google = createGoogleGenerativeAI({ apiKey: config.ai.googleApiKey })
          return google.embeddingModel("gemini-embedding-001")
        },
      }
    }),
  )
}
