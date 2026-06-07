import { Effect } from "effect"
import { generateText } from "ai"
import { ModelProvider } from "../model-provider"

const SYSTEM_PROMPT = `Generate a concise title (5-8 words) for this chat conversation.
- No punctuation at the end
- No quotes around the title
- Capture the core topic
- Return ONLY the title, nothing else`

export function generateChatTitle(
  userMessage: string,
  assistantMessage: string,
): Effect.Effect<string, Error, ModelProvider> {
  return Effect.gen(function* () {
    const models = yield* ModelProvider

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: models.processingModel(),
          system: SYSTEM_PROMPT,
          prompt: `User: ${userMessage}\n\nAssistant: ${assistantMessage}`,
          providerOptions: models.processingProviderOptions(),
        }),
      catch: (e) => e as Error,
    })

    const title = result.text.trim()
    if (!title) {
      return yield* Effect.fail(new Error("Title generation returned no text"))
    }

    return title
  })
}
