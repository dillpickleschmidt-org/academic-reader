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
): Effect.Effect<string, never, ModelProvider> {
  return Effect.gen(function* () {
    const models = yield* ModelProvider

    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: models.processingModel(),
          system: SYSTEM_PROMPT,
          prompt: `User: ${userMessage}\n\nAssistant: ${assistantMessage}`,
        }),
      catch: (e) => e,
    }).pipe(Effect.either)

    if (result._tag === "Left") {
      console.warn("[title-generation] AI generation failed:", result.left)
      return ""
    }

    return result.right.text?.trim() || ""
  })
}
