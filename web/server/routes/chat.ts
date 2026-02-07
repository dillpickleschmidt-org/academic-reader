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
import type { Id, Doc } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { webSearch, type ExaSearchResult } from "@exalabs/ai-sdk"
import { createChatModel } from "../providers/models"
import { generateEmbedding } from "../services/embeddings"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import { publishStreamMessage } from "../services/redis"
import { generateChatTitle } from "../services/title-generation"
import { env } from "../env"

interface DocumentContext {
  documentId?: string
  summary?: string
}

interface ChatRequest {
  messages: UIMessage[]
  threadId: string
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
            (c: { html: string; page: number; section?: string }, i: number) =>
              `[${i + 1}] (Page ${c.page}${c.section ? `, ${c.section}` : ""}): ${c.html}`,
          )
          .join("\n\n")
      } catch (error) {
        console.error("Search error:", error)
        return "Search encountered an error. Please try again."
      }
    },
  })
}

function stripExaResponse({
  results,
  requestId,
  resolvedSearchType,
  searchTime,
  costDollars,
  effectiveFilters,
  requestTags,
}: {
  // ExaApiResponse isn't exported from the sdk so just defining what we know + allow additional
  results: ExaSearchResult[]
  requestId?: string
  resolvedSearchType?: string
  searchTime?: number
  costDollars?: unknown
  effectiveFilters?: unknown
  requestTags?: unknown
  [k: string]: unknown
}) {
  return {
    results: results.map(
      ({
        title,
        url,
        id,
        publishedDate,
        author,
        image,
        favicon,
        text,
        highlights,
        highlightScores,
        summary,
      }) => ({
        title,
        url,
        id,
        publishedDate,
        author,
        image,
        favicon,
        text,
        highlights,
        highlightScores,
        summary,
      }),
    ),
    requestId,
    resolvedSearchType,
    searchTime,
    costDollars,
    effectiveFilters,
    requestTags,
  }
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

  const { messages, threadId, documentContext } = bodyResult.data

  if (!documentContext?.documentId) {
    event.error = {
      category: "validation",
      message: "documentId is required",
      code: "DOCUMENT_ID_REQUIRED",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "documentId is required" }, 400)
  }

  if (!threadId) {
    event.error = {
      category: "validation",
      message: "threadId is required",
      code: "THREAD_ID_REQUIRED",
    }
    emitStreamingEvent(event, { status: 400 })
    return c.json({ error: "threadId is required" }, 400)
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
        parts: [{ type: "text", text: userText }],
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

  // Use client-provided summary, or poll until enrichment completes
  const typedDocId = documentContext.documentId as Id<"documents">
  let summary = documentContext.summary
  if (summary === undefined) {
    const deadline = Date.now() + 60_000
    while (summary === undefined && Date.now() < deadline) {
      const poll = await tryCatch(
        convex.query(api.api.documents.get, { documentId: typedDocId }),
      )
      if (poll.success && poll.data) {
        summary = poll.data.summary
      }
      if (summary === undefined) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
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

You also have web search tools available:
- Use the webSearch tool to find information online when the user asks about cited papers, external concepts, related work, or anything not in the document
- Use the extractPage tool to read the full content of a specific URL from search results when you need more detail
- When using web search results, cite the source URLs

Do not narrate or announce tool usage. Just use tools silently and provide the answer.`

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

  const tools: Record<string, any> = {
    // @exalabs/ai-sdk webSearch tool is incompatible with ToolSet
    searchDocument: createSearchTool(documentContext.documentId, convex),
    webSearch: webSearch({
      apiKey: env.EXA_API_KEY,
      numResults: 10,
      contents: {
        highlights: {
          numSentences: 5,
          highlightsPerUrl: 3,
        },
      },
    }),
    extractPage: tool({
      description:
        "Extract the full content of a specific web page URL for detailed reading",
      inputSchema: z.object({
        url: z.url().describe("The URL to extract content from"),
      }),
      execute: async ({ url }) => {
        const res = await fetch("https://api.exa.ai/contents", {
          method: "POST",
          headers: {
            "x-api-key": env.EXA_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ urls: [url], text: true }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) return "Could not extract content from this URL."
        const data = (await res.json()) as {
          results?: { title?: string; url: string; text?: string }[]
        }
        const result = data.results?.[0]
        if (!result?.text) return "Could not extract content from this URL."
        return `# ${result.title ?? "Untitled"}\n${result.url}\n\n${result.text}`
      },
    }),
  }

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

        const isFirstMessage = messages.length === 1 && !!userText
        const fallbackTitle = isFirstMessage
          ? userText!.slice(0, 20)
          : undefined

        // Build parts array matching what useChat sees during streaming
        const parts: Doc<"chatMessages">["parts"] = []
        for (const step of steps) {
          for (const result of step.toolResults) {
            const isWebSearch = result.toolName === "webSearch"
            const output = isWebSearch
              ? stripExaResponse(
                  result.output as Parameters<typeof stripExaResponse>[0],
                )
              : result.output
            parts.push({
              type: `tool-${result.toolName}`,
              toolCallId: result.toolCallId,
              state: "output-available",
              input: result.input,
              output,
            } as Doc<"chatMessages">["parts"][number])
          }
        }
        parts.push({ type: "text", text })

        await tryCatch(
          convex.mutation(api.api.chat.finishStreaming, {
            threadId: threadId as Id<"chatThreads">,
            parts,
            title: fallbackTitle,
          }),
        )

        // Publish done to Redis
        await publishStreamMessage(threadId, { type: "done" })

        // Fire-and-forget: generate LLM title for new threads
        if (isFirstMessage) {
          generateChatTitle(userText!, text)
            .then(async (llmTitle) => {
              if (!llmTitle) return
              await convex.mutation(api.api.chat.updateThreadTitle, {
                threadId: threadId as Id<"chatThreads">,
                title: llmTitle,
              })
            })
            .catch((err) =>
              console.warn("[chat] Background title generation failed:", err),
            )
        }

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

  return streamResult.data.toUIMessageStreamResponse()
})
