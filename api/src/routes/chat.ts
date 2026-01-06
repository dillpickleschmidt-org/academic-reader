import { Hono } from "hono"
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type UIDataTypes,
  type InferUITools,
} from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { Env } from "../types"

const tools = {}

export type ChatTools = InferUITools<typeof tools>
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>

export const chat = new Hono<{ Bindings: Env }>()

chat.post("/chat", async (c) => {
  try {
    const { messages }: { messages: ChatMessage[] } = await c.req.json()

    const google = createGoogleGenerativeAI({
      apiKey: c.env.GOOGLE_API_KEY,
    })

    const result = streamText({
      model: google("gemini-3-flash-preview"),
      messages: await convertToModelMessages(messages),
      system: `You are a helpful assistant with access to a knowledge base.
When users ask questions, search the knowledge base for relevant information.
Always search before answering if the question might relate to uploaded documents.
Base your answers on the search results when available. Give concise answers that correctly answer what the user is asking for. Do not flood them with all the information from the search results.`,
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error("Error streaming chat completion:", error)
    return c.json({ error: "Failed to stream chat completion" }, 500)
  }
})
