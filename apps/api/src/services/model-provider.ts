import { Context, Effect, Layer } from "effect"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq, type GroqProviderOptions } from "@ai-sdk/groq"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel, EmbeddingModel } from "ai"
import { AppConfig } from "../config"

export type ModelProviderOptions =
  | { groq: Pick<GroqProviderOptions, "reasoningEffort"> }
  | undefined

export interface ModelProviderService {
  chatModel(): LanguageModel
  chatProviderOptions(): ModelProviderOptions
  processingModel(): LanguageModel
  processingProviderOptions(): ModelProviderOptions
  summaryModel(): LanguageModel
  summaryProviderOptions(): ModelProviderOptions
  embeddingModel(): EmbeddingModel
}

export class ModelProvider extends Context.Tag("ModelProvider")<
  ModelProvider,
  ModelProviderService
>() {
  static Live = Layer.effect(
    ModelProvider,
    Effect.gen(function* () {
      const config = yield* AppConfig

      function createModel(provider: string, model: string): LanguageModel {
        if (provider === "openrouter") {
          const openrouter = createOpenRouter({
            apiKey: config.ai.openrouterApiKey ?? "",
          })
          return openrouter.chat(model)
        }

        if (provider === "groq") {
          const groq = createGroq({ apiKey: config.ai.groqApiKey ?? "" })
          return groq(model)
        }

        const google = createGoogleGenerativeAI({
          apiKey: config.ai.googleApiKey,
        })
        return google(model)
      }

      function providerOptions(
        provider: string,
        model: string,
      ): ModelProviderOptions {
        if (provider === "groq" && model.startsWith("openai/gpt-oss-")) {
          return { groq: { reasoningEffort: "low" } }
        }

        return undefined
      }

      return {
        chatModel: () =>
          createModel(config.ai.chat.provider, config.ai.chat.model),
        chatProviderOptions: () =>
          providerOptions(config.ai.chat.provider, config.ai.chat.model),
        processingModel: () =>
          createModel(
            config.ai.processing.provider,
            config.ai.processing.model,
          ),
        processingProviderOptions: () =>
          providerOptions(
            config.ai.processing.provider,
            config.ai.processing.model,
          ),
        summaryModel: () =>
          createModel(config.ai.summary.provider, config.ai.summary.model),
        summaryProviderOptions: () =>
          providerOptions(config.ai.summary.provider, config.ai.summary.model),
        embeddingModel: () => {
          const google = createGoogleGenerativeAI({
            apiKey: config.ai.googleApiKey,
          })
          return google.embeddingModel("gemini-embedding-2")
        },
      }
    }),
  )
}
