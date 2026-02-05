import { Hono } from "hono"
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai"
import { z } from "zod"
import type { ConvexHttpClient } from "convex/browser"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { createChatModel } from "../providers/models"
import { generateEmbedding, stripHtmlForEmbedding } from "../services/embeddings"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { publishStreamMessage } from "../services/redis"

interface DocumentContext {
  documentId?: string
}

interface ChatRequest {
  messages: UIMessage[]
  threadId?: string
  documentContext?: DocumentContext
}

const activeStreams = new Map<string, AbortController>()

function createSearchTool(
  documentId: string | undefined,
  convex: ConvexHttpClient,
) {
  return tool({
    description:
      "Search the uploaded document for relevant information to answer the user's question",
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant passages"),
    }),
    execute: async ({ query }) => {
      if (!documentId) {
        return "No document available for search."
      }

      try {
        const queryEmbedding = await generateEmbedding(query)

        const chunks = await convex.action(api.api.documents.search, {
          documentId: documentId as Id<"documents">,
          queryEmbedding,
          limit: 5,
        })

        if (!chunks || chunks.length === 0) {
          return "No relevant information found in the document."
        }

        return chunks
          .map(
            (
              c: { html: string; page: number; section?: string },
              i: number,
            ) =>
              `[${i + 1}] (Page ${c.page}${c.section ? `, ${c.section}` : ""}): ${stripHtmlForEmbedding(c.html)}`,
          )
          .join("\n\n")
      } catch (error) {
        console.error("Search error:", error)
        return "Search encountered an error. Please try again."
      }
    },
  })
}

function extractUserMessage(messages: UIMessage[]): string | undefined {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") return undefined
  const textPart = last.parts.find((p) => p.type === "text")
  return textPart?.type === "text" ? textPart.text : undefined
}

export const chat = new Hono()

chat.use("/chat", requireAuth)

chat.post("/chat", async (c) => {
  const event = c.get("event")

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    emitStreamingEvent(event, { status: 401 })
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<ChatRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { messages, threadId: existingThreadId, documentContext } = bodyResult.data

  if (!documentContext?.documentId) {
    event.error = {
      category: "validation",
      message: "documentId is required",
      code: "DOCUMENT_ID_REQUIRED",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "documentId is required" }, 400)
  }

  // Create or reuse thread
  let threadId: string
  if (existingThreadId) {
    threadId = existingThreadId
  } else {
    const createResult = await tryCatch(
      convex.mutation(api.api.chat.createThread, {
        documentId: documentContext.documentId as Id<"documents">,
      }),
    )
    if (!createResult.success) {
      event.error = {
        category: "backend",
        message: getErrorMessage(createResult.error),
        code: "THREAD_CREATE_ERROR",
      }
      emitStreamingEvent(event, { status: 500 })
      return c.json({ error: "Failed to create thread" }, 500)
    }
    threadId = createResult.data
  }

  // Cancel any in-flight stream for this thread
  const existing = activeStreams.get(threadId)
  if (existing) {
    existing.abort()
    activeStreams.delete(threadId)
  }

  // Save user message and set streaming flag in one transaction
  const userText = extractUserMessage(messages)
  if (userText) {
    await tryCatch(
      convex.mutation(api.api.chat.addMessageAndStartStreaming, {
        threadId: threadId as Id<"chatThreads">,
        content: userText,
      }),
    )
  } else {
    await tryCatch(
      convex.mutation(api.api.chat.setStreaming, {
        threadId: threadId as Id<"chatThreads">,
        isStreaming: true,
      }),
    )
  }

  // Fetch document for pre-generated summary
  let summary: string | undefined
  const docResult = await tryCatch(
    convex.query(api.api.documents.get, {
      documentId: documentContext.documentId as Id<"documents">,
    }),
  )
  if (docResult.success && docResult.data) {
    summary = docResult.data.summary
  }

  const summaryBlock = summary
    ? `\nHere is a pre-generated summary of the document:\n<summary>\n${summary}\n</summary>\n`
    : ""

  const systemPrompt = `You are an academic assistant helping users understand research papers and documents.
${summaryBlock}
The user has a document loaded and may ask questions about it. When answering:
1. Use the searchDocument tool to find relevant passages from the document
2. Base your answers on the search results
3. Cite page numbers when referencing specific information
4. If the search doesn't return relevant results, say so honestly
5. Be concise and directly answer what was asked

If the user asks a general question not about the document, answer normally without searching.`

  let model
  try {
    model = createChatModel()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "MODEL_CONFIG_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Server configuration error" }, 500)
  }

  const tools = { searchDocument: createSearchTool(documentContext.documentId, convex) }

  const abortController = new AbortController()
  activeStreams.set(threadId, abortController)

  const streamStart = performance.now()
  let streamError: string | undefined

  const streamResult = await tryCatch(async () =>
    streamText({
      model,
      messages: await convertToModelMessages(messages),
      system: systemPrompt,
      tools,
      abortSignal: abortController.signal,
      stopWhen: stepCountIs(20),
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          publishStreamMessage(threadId, { type: "token", text: chunk.text })
        }
      },
      onError: ({ error }) => {
        streamError = getErrorMessage(error)
        publishStreamMessage(threadId, {
          type: "error",
          message: streamError,
        })
        convex.mutation(api.api.chat.setStreaming, {
          threadId: threadId as Id<"chatThreads">,
          isStreaming: false,
        })
        activeStreams.delete(threadId)
      },
      onFinish: async ({
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
        activeStreams.delete(threadId)

        // Save assistant message, clear streaming, and set title in one transaction
        const title = !existingThreadId && userText
          ? userText.slice(0, 80)
          : undefined
        await tryCatch(
          convex.mutation(api.api.chat.finishStreaming, {
            threadId: threadId as Id<"chatThreads">,
            assistantContent: text,
            title,
          }),
        )

        // Publish done to Redis
        await publishStreamMessage(threadId, { type: "done" })

        emitStreamingEvent(event, {
          durationMs: Math.round(performance.now() - streamStart),
          status: 200,
          responseId: response.id,
          modelId: response.modelId,
          finishReason,
          rawFinishReason,
          inputTokenCount: usage.inputTokens,
          outputTokenCount: usage.outputTokens,
          totalTokenCount: usage.totalTokens,
          totalInputTokenCount: totalUsage.inputTokens,
          totalOutputTokenCount: totalUsage.outputTokens,
          grandTotalTokenCount: totalUsage.totalTokens,
          responseLength: text.length,
          reasoningLength: reasoningText?.length,
          sourceCount: sources.length,
          stepCount: steps.length,
          toolCallCount: toolCalls?.length ?? 0,
          messageCount: messages.length,
          warningCount: warnings?.length ?? 0,
          warnings: warnings?.length ? warnings.map((w) => w.type) : undefined,
          streamError,
        })
      },
    }),
  )

  if (!streamResult.success) {
    activeStreams.delete(threadId)
    await tryCatch(
      convex.mutation(api.api.chat.setStreaming, {
        threadId: threadId as Id<"chatThreads">,
        isStreaming: false,
      }),
    )
    event.error = {
      category: "backend",
      message: getErrorMessage(streamResult.error),
      code: "AI_STREAM_ERROR",
    }
    emitStreamingEvent(event, { status: 500 })
    return c.json({ error: "Failed to stream chat completion" }, 500)
  }

  const response = streamResult.data.toUIMessageStreamResponse()

  // Add thread ID header so client can capture it for new threads
  response.headers.set("x-thread-id", threadId)

  return response
})
