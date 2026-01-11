import { Hono } from "hono"
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai"
import { z } from "zod"
import { createChatModel } from "../providers/models"
import { generateEmbedding } from "../services/embeddings"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"

// Document context passed from frontend
interface DocumentContext {
  markdown?: string // Full document for summary (first message only)
  documentId?: string // For RAG searches (after storage)
  isFirstMessage: boolean
}

interface ChatRequest {
  messages: UIMessage[]
  documentContext?: DocumentContext
}

// Create search tool with documentId captured via closure
function createSearchTool(documentId: string | undefined) {
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
        // Generate embedding for query
        const queryEmbedding = await generateEmbedding(query)

        // Call Convex to search (admin API on port 3210)
        const convexUrl = process.env.CONVEX_SITE_URL || "http://localhost:3210"
        const response = await fetch(`${convexUrl}/api/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "api/documents:search",
            args: {
              documentId,
              queryEmbedding,
              limit: 5,
            },
          }),
        })

        if (!response.ok) {
          return "Search failed. Please try again."
        }

        const chunks = await response.json()

        if (!chunks || chunks.length === 0) {
          return "No relevant information found in the document."
        }

        // Format results with page citations
        return chunks
          .map(
            (c: { content: string; page: number; section?: string }, i: number) =>
              `[${i + 1}] (Page ${c.page}${c.section ? `, ${c.section}` : ""}): ${c.content}`,
          )
          .join("\n\n")
      } catch (error) {
        console.error("Search error:", error)
        return "Search encountered an error. Please try again."
      }
    },
  })
}

export const chat = new Hono()

chat.use("/chat", requireAuth)

chat.post("/chat", async (c) => {
  const event = c.get("event")

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

  const { messages, documentContext } = bodyResult.data

  // Determine mode: Summary (first message with markdown) vs RAG (follow-ups)
  const isSummaryMode =
    documentContext?.isFirstMessage && documentContext?.markdown

  // Build system prompt based on mode
  let systemPrompt: string

  if (isSummaryMode) {
    // Summary mode: Include full markdown, request concise summary
    systemPrompt = `You are an academic assistant helping users understand research papers and documents.

The user has uploaded a document. Here is the full content:

<document>
${documentContext.markdown}
</document>

Provide a concise, one-paragraph summary that captures:
- The main topic or thesis
- Key findings, arguments, or contributions
- The significance or implications

Be direct and informative. Avoid phrases like "This document discusses..." - just state the content directly.`
  } else {
    // RAG mode: Use search tool for follow-up questions
    systemPrompt = `You are an academic assistant helping users understand research papers and documents.

The user has a document loaded and may ask questions about it. When answering:
1. Use the searchDocument tool to find relevant passages from the document
2. Base your answers on the search results
3. Cite page numbers when referencing specific information
4. If the search doesn't return relevant results, say so honestly
5. Be concise and directly answer what was asked

If the user asks a general question not about the document, answer normally without searching.`
  }

  // Create model using provider abstraction
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

  // Create tools with documentId context (undefined for summary mode)
  const tools = isSummaryMode
    ? undefined
    : { searchDocument: createSearchTool(documentContext?.documentId) }

  const streamStart = performance.now()
  let streamError: string | undefined

  const streamResult = await tryCatch(async () =>
    streamText({
      model,
      messages: await convertToModelMessages(messages),
      system: systemPrompt,
      tools,
      stopWhen: isSummaryMode ? undefined : stepCountIs(3), // Allow tool use + response
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
          // Mode tracking
          mode: isSummaryMode ? "summary" : "rag",
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
