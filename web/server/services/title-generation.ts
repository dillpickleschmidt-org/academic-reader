import { generateText } from "ai"
import { createProcessingModel } from "../providers/models"
import { tryCatch } from "../utils/try-catch"

const SYSTEM_PROMPT = `Generate a concise title (5-8 words) for this chat conversation.
- No punctuation at the end
- No quotes around the title
- Capture the core topic
- Return ONLY the title, nothing else`

export async function generateChatTitle(
  userMessage: string,
  assistantMessage: string,
): Promise<string> {
  const model = createProcessingModel()

  const result = await tryCatch(
    generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: `User: ${userMessage}\n\nAssistant: ${assistantMessage}`,
    }),
  )

  if (!result.success) {
    console.warn("[title-generation] AI generation failed:", result.error)
    return ""
  }

  return result.data.text?.trim() || ""
}
