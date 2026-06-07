import { generateText } from "ai"
import { Effect } from "effect"
import { ModelProvider } from "../model-provider"

const MAX_INPUT_CHARS = 2_000_000

const SYSTEM_PROMPT = `You are a summarizer. You write a summary of the input using following steps:
1.) Analyze the input text and generate 5 essential questions that, when answered, capture the main points and core meaning of the text.
2.) When formulating your questions: a. Address the central theme or argument b. Identify key supporting ideas c. Highlight important facts or evidence d. Reveal the author's purpose or perspective e. Explore any significant implications or conclusions.
3.) Answer all of your generated questions one-by-one in detail.`

export function generateDocumentSummary(chunkHtml: string) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider

    if (!chunkHtml.trim()) {
      return yield* Effect.fail(new Error("Cannot summarize empty document"))
    }

    const input =
      chunkHtml.length > MAX_INPUT_CHARS
        ? chunkHtml.slice(0, MAX_INPUT_CHARS)
        : chunkHtml

    const model = models.summaryModel()

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model,
          system: SYSTEM_PROMPT,
          prompt: input,
          providerOptions: models.summaryProviderOptions(),
        }),
      catch: (e) => e as Error,
    })

    const summary = result.text.trim()
    if (!summary) {
      return yield* Effect.fail(new Error("Summary generation returned no text"))
    }

    return summary
  })
}
