import { generateText } from "ai"
import { createProcessingModel } from "../providers/models"
import { tryCatch } from "../utils/try-catch"

const MAX_INPUT_CHARS = 2_000_000

const SYSTEM_PROMPT = `You are a summarizer. You write a summary of the input using following steps:
1.) Analyze the input text and generate 5 essential questions that, when answered, capture the main points and core meaning of the text.
2.) When formulating your questions: a. Address the central theme or argument b. Identify key supporting ideas c. Highlight important facts or evidence d. Reveal the author's purpose or perspective e. Explore any significant implications or conclusions.
3.) Answer all of your generated questions one-by-one in detail.`

/**
 * Generate a detailed Q&A summary from document chunk HTML.
 * Returns empty string on failure.
 */
export async function generateDocumentSummary(
  chunkHtml: string,
): Promise<string> {
  if (!chunkHtml.trim()) return ""

  const input = chunkHtml.length > MAX_INPUT_CHARS
    ? chunkHtml.slice(0, MAX_INPUT_CHARS)
    : chunkHtml

  const model = createProcessingModel()

  const result = await tryCatch(
    generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: input,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
    }),
  )

  if (!result.success) {
    console.warn("[summary] AI generation failed:", result.error)
    return ""
  }

  return result.data.text || ""
}
