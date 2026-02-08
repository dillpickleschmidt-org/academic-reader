import { Effect, Layer } from "effect"
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai"
import { z } from "zod"
import type { ConvexHttpClient } from "convex/browser"
import { webSearch, type ExaSearchResult } from "@exalabs/ai-sdk"
import { ModelProvider } from "../model-provider"
import { generateEmbedding } from "./embeddings"
import { generateChatTitle } from "./title-generation"
import { AppConfig } from "../../config"

interface ChatInput {
  messages: UIMessage[]
  threadId: string
  documentId: string
  summary?: string
  convex: ConvexHttpClient
}

const activeStreams = new Map<string, AbortController>()

export function runChatStream(
  input: ChatInput,
): Effect.Effect<Response, Error, ModelProvider | AppConfig> {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const config = yield* AppConfig

    const { messages, threadId, documentId, summary, convex } = input

    // Cancel any in-flight stream for this thread
    const existing = activeStreams.get(threadId)
    if (existing) {
      existing.abort()
      activeStreams.delete(threadId)
    }

    // Save user message and set streaming flag
    const userText = extractUserMessage(messages)
    if (userText) {
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/chat:addMessageAndStartStreaming" as any, {
            threadId,
            parts: [{ type: "text", text: userText }],
          }),
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.void))
    } else {
      yield* Effect.tryPromise({
        try: () =>
          convex.mutation("api/chat:setStreaming" as any, {
            threadId,
            isStreaming: true,
          }),
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.void))
    }

    // Poll for summary if not provided
    let resolvedSummary = summary
    if (resolvedSummary === undefined) {
      const deadline = Date.now() + 60_000
      while (resolvedSummary === undefined && Date.now() < deadline) {
        const poll = yield* Effect.tryPromise({
          try: () =>
            convex.query("api/documents:get" as any, { documentId }),
          catch: () => null,
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))

        if (poll && typeof poll === "object" && "summary" in poll) {
          resolvedSummary = (poll as { summary?: string }).summary
        }
        if (resolvedSummary === undefined) {
          yield* Effect.sleep("1 second")
        }
      }
    }

    const summaryBlock = resolvedSummary
      ? `\nHere is a pre-generated summary of the document:\n<summary>\n${resolvedSummary}\n</summary>\n`
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

    const model = models.chatModel()
    const exaApiKey = config.ai.exaApiKey

    const tools: Record<string, any> = {
      searchDocument: createSearchTool(documentId, convex, models),
      webSearch: webSearch({
        apiKey: exaApiKey,
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
              "x-api-key": exaApiKey,
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

    const modelMessages = yield* Effect.tryPromise({
      try: () => convertToModelMessages(messages),
      catch: (e) => new Error(`Failed to convert messages: ${e}`),
    })

    const stream = streamText({
      model,
      messages: modelMessages,
      system: systemPrompt,
      tools,
      abortSignal: abortController.signal,
      stopWhen: stepCountIs(20),
      onError: ({ error }) => {
        convex.mutation("api/chat:setStreaming" as any, {
          threadId,
          isStreaming: false,
        })
        activeStreams.delete(threadId)
        console.error("[chat] Stream error:", error)
      },
      onFinish: async ({ usage, finishReason, response, text, sources, steps, totalUsage }) => {
        activeStreams.delete(threadId)

        const isFirstMessage = messages.length === 1 && !!userText
        const fallbackTitle = isFirstMessage ? userText!.slice(0, 20) : undefined

        const parts: any[] = []
        for (const step of steps) {
          for (const result of step.toolResults) {
            const isWebSearch = result.toolName === "webSearch"
            const output = isWebSearch
              ? stripExaResponse(result.output as Parameters<typeof stripExaResponse>[0])
              : result.output
            parts.push({
              type: `tool-${result.toolName}`,
              toolCallId: result.toolCallId,
              state: "output-available",
              input: result.input,
              output,
            })
          }
        }
        parts.push({ type: "text", text })

        try {
          await convex.mutation("api/chat:finishStreaming" as any, {
            threadId,
            parts,
            title: fallbackTitle,
          })
        } catch (e) {
          console.warn("[chat] Failed to save message:", e)
        }

        // Fire-and-forget: generate LLM title for new threads
        if (isFirstMessage) {
          Effect.runPromise(
            Effect.provide(
              generateChatTitle(userText!, text),
              ModelProvider.Live.pipe(Layer.provide(AppConfig.Live)),
            ),
          )
            .then(async (llmTitle) => {
              if (!llmTitle) return
              await convex.mutation("api/chat:updateThreadTitle" as any, {
                threadId,
                title: llmTitle,
              })
            })
            .catch((err) =>
              console.warn("[chat] Background title generation failed:", err),
            )
        }
      },
    })

    return stream.toUIMessageStreamResponse()
  })
}

function createSearchTool(
  documentId: string,
  convex: ConvexHttpClient,
  models: { embeddingModel: () => any },
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
        const queryEmbedding = await Effect.runPromise(
          Effect.provide(
            generateEmbedding(query),
            ModelProvider.Live.pipe(Layer.provide(AppConfig.Live)),
          ),
        )

        const chunks = await convex.action("api/documents:search" as any, {
          documentId,
          queryEmbedding,
          limit: 5,
        })

        if (!chunks || (chunks as any[]).length === 0) {
          return "No relevant information found in the document."
        }

        return (chunks as { html: string; page: number; section?: string }[])
          .map(
            (c, i) =>
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

function extractUserMessage(messages: UIMessage[]): string | undefined {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") return undefined
  const textPart = last.parts.find((p) => p.type === "text")
  return textPart?.type === "text" ? textPart.text : undefined
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
