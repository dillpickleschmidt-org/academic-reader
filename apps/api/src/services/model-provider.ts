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

      const model = () => {
        if (config.ai.provider === "openrouter") {
          return createOpenRouter({
            apiKey: config.ai.openrouterApiKey ?? "",
          }).chat(config.ai.model)
        }

        if (config.ai.provider === "groq") {
          return createGroq({ apiKey: config.ai.groqApiKey ?? "" })(
            config.ai.model,
          )
        }

        return createGoogleGenerativeAI({
          apiKey: config.ai.googleApiKey,
        })(config.ai.model)
      }

      const providerOptions = (): ModelProviderOptions => {
        if (
          config.ai.provider === "groq" &&
          config.ai.model.startsWith("openai/gpt-oss-")
        ) {
          return { groq: { reasoningEffort: "low" } }
        }

        return undefined
      }

      return {
        chatModel: model,
        chatProviderOptions: providerOptions,
        processingModel: model,
        processingProviderOptions: providerOptions,
        summaryModel: model,
        summaryProviderOptions: providerOptions,
        embeddingModel: () =>
          createGoogleGenerativeAI({
            apiKey: config.ai.googleApiKey,
          }).embeddingModel("gemini-embedding-2"),
      }
    }),
  )
}
