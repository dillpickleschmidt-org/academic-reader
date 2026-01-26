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
import { generateEmbedding } from "../services/embeddings"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { loadPersistedDocument } from "../services/document-persistence"
import type { Storage } from "../storage/types"

// Document context passed from frontend (markdown fetched server-side)
interface DocumentContext {
  documentId?: string // Required for both summary and RAG
  isFirstMessage: boolean
}

interface ChatRequest {
  messages: UIMessage[]
  documentContext?: DocumentContext
}

// Create search tool with documentId and authenticated client
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
        // Generate embedding for query
        const queryEmbedding = await generateEmbedding(query)

        // Call Convex to search using authenticated client
        const chunks = await convex.action(api.api.documents.search, {
          documentId: documentId as Id<"documents">,
          queryEmbedding,
          limit: 5,
        })

        if (!chunks || chunks.length === 0) {
          return "No relevant information found in the document."
        }

        // Format results with page citations
        return chunks
          .map(
            (
              c: { content: string; page: number; section?: string },
              i: number,
            ) =>
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

type Variables = {
  storage: Storage
  userId: string
}

export const chat = new Hono<{ Variables: Variables }>()

chat.use("/chat", requireAuth)

chat.post("/chat", async (c) => {
  const event = c.get("event")
  const storage = c.get("storage")
  const userId = c.get("userId")

  // Create authenticated Convex client for RAG searches
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

  const { messages, documentContext } = bodyResult.data

  // Require documentId for all chat operations
  if (!documentContext?.documentId) {
    event.error = {
      category: "validation",
      message: "documentId is required",
      code: "DOCUMENT_ID_REQUIRED",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "documentId is required" }, 400)
  }

  const isSummaryMode = documentContext.isFirstMessage
  let markdown: string | undefined

  // For summary mode, fetch markdown from S3
  if (isSummaryMode) {
    // Get document from Convex to retrieve storageId
    const docResult = await tryCatch(
      convex.query(api.api.documents.get, {
        documentId: documentContext.documentId as Id<"documents">,
      }),
    )

    if (!docResult.success || !docResult.data) {
      event.error = {
        category: "storage",
        message: !docResult.success
          ? getErrorMessage(docResult.error)
          : "Document not found",
        code: "DOCUMENT_NOT_FOUND",
      }
      emitStreamingEvent(event, { status: 404 })
      return c.json({ error: "Document not found" }, 404)
    }

    // Load markdown from S3
    const loadResult = await tryCatch(
      loadPersistedDocument(storage, userId, docResult.data.storageId),
    )

    if (!loadResult.success) {
      event.error = {
        category: "storage",
        message: getErrorMessage(loadResult.error),
        code: "DOCUMENT_LOAD_ERROR",
      }
      emitStreamingEvent(event, { status: 500 })
      return c.json({ error: "Failed to load document" }, 500)
    }

    markdown = loadResult.data.markdown
  }

  // Build system prompt based on mode
  let systemPrompt: string

  if (isSummaryMode && markdown) {
    // Summary mode: Include full markdown, request concise summary
    systemPrompt = `You are an academic assistant helping users understand research papers and documents.

The user has uploaded a document. Here is the full content:

<document>
${markdown}
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
    : { searchDocument: createSearchTool(documentContext?.documentId, convex) }

  const streamStart = performance.now()
  let streamError: string | undefined

  const streamResult = await tryCatch(async () =>
    streamText({
      model,
      messages: await convertToModelMessages(messages),
      system: systemPrompt,
      tools,
      stopWhen: isSummaryMode ? undefined : stepCountIs(20),
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
