import { Hono } from "hono"
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type UIDataTypes,
  type InferUITools,
} from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event"

const tools = {}

export type ChatTools = InferUITools<typeof tools>
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>

export const chat = new Hono()

chat.use("/chat", requireAuth)

chat.post("/chat", async (c) => {
  const event = c.get("event")

  const bodyResult = await tryCatch(c.req.json<{ messages: ChatMessage[] }>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { messages } = bodyResult.data

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
  })

  const modelName = "gemini-3-flash-preview"
  const streamStart = performance.now()
  let streamError: string | undefined

  const streamResult = await tryCatch(async () =>
    streamText({
      model: google(modelName),
      messages: await convertToModelMessages(messages),
      system: `You are a helpful assistant with access to a knowledge base.
When users ask questions, search the knowledge base for relevant information.
Always search before answering if the question might relate to uploaded documents.
Base your answers on the search results when available. Give concise answers that correctly answer what the user is asking for. Do not flood them with all the information from the search results.`,
      onError: ({ error }) => {
        streamError = getErrorMessage(error)
      },
      onFinish: ({
        usage,
        finishReason,
        rawFinishReason,
        toolCalls,
        warnings,
        response,
        text,
        sources,
        reasoningText,
        steps,
        totalUsage,
      }) => {
        emitStreamingEvent(event, {
          durationMs: Math.round(performance.now() - streamStart),
          status: 200,
          // Response metadata
          responseId: response.id,
          modelId: response.modelId,
          finishReason,
          rawFinishReason,
          // Usage (last step)
          inputTokenCount: usage.inputTokens,
          outputTokenCount: usage.outputTokens,
          totalTokenCount: usage.totalTokens,
          // Usage (all steps combined)
          totalInputTokenCount: totalUsage.inputTokens,
          totalOutputTokenCount: totalUsage.outputTokens,
          grandTotalTokenCount: totalUsage.totalTokens,
          // Content metrics
          responseLength: text.length,
          reasoningLength: reasoningText?.length,
          sourceCount: sources.length,
          // Execution metrics
          stepCount: steps.length,
          toolCallCount: toolCalls?.length ?? 0,
          messageCount: messages.length,
          // Warnings
          warningCount: warnings?.length ?? 0,
          warnings: warnings?.length ? warnings.map((w) => w.type) : undefined,
          streamError,
        })
      },
    }),
  )
  if (!streamResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(streamResult.error),
      code: "AI_STREAM_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to stream chat completion" }, 500)
  }

  return streamResult.data.toUIMessageStreamResponse()
})
