import { Effect } from "effect"
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { webSearch } from "@exalabs/ai-sdk"
import type { Doc } from "@academic-reader/convex/convex/_generated/dataModel"
import type { ConvexSession } from "../convex-client"
import { ModelProvider, type ModelProviderService } from "../model-provider"
import { generateEmbedding } from "./embeddings"
import { generateChatTitle } from "./title-generation"
import { AppConfig } from "../../config"
import type { WideEvent } from "../../middleware/wide-event"
import { emitStreamingEvent } from "../../middleware/wide-event"

type ChatMessageParts = Doc<"chatMessages">["parts"]

interface ChatInput {
  messages: UIMessage[]
  threadId: string
  documentId: string
  summary: string | null
  convex: ConvexSession
  event: WideEvent
}

const activeStreams = new Map<string, AbortController>()

export function runChatStream(
  input: ChatInput,
): Effect.Effect<Response, Error, ModelProvider | AppConfig> {
  return Effect.gen(function* () {
    const models = yield* ModelProvider
    const config = yield* AppConfig

    const { messages, threadId, documentId, summary, convex, event } = input
    const streamStart = performance.now()

    // Cancel any in-flight stream for this thread
    const existing = activeStreams.get(threadId)
    if (existing) {
      existing.abort()
      activeStreams.delete(threadId)
    }

    const userText = extractUserMessage(messages)
    if (userText) {
      const parts: ChatMessageParts = [{ type: "text", text: userText }]
      yield* Effect.tryPromise({
        try: () => convex.addUserMessage(threadId, parts),
        catch: (e) => e as Error,
      })
    }

    // Poll for summary if not provided
    let resolvedSummary = summary
    if (resolvedSummary === null) {
      const deadline = Date.now() + 60_000
      while (resolvedSummary === null && Date.now() < deadline) {
        const poll = yield* Effect.tryPromise({
          try: () => convex.getDocument(documentId),
          catch: () => null,
        }).pipe(Effect.catchAll(() => Effect.succeed(null)))

        if (poll && poll.summary !== null) {
          resolvedSummary = poll.summary
        }
        if (resolvedSummary === null) {
          yield* Effect.sleep("1 second")
        }
      }
    }

    const summaryBlock = resolvedSummary
      ? `\nHere is a pre-generated summary of the document:\n<summary>\n${resolvedSummary}\n</summary>\n`
      : ""

    const webSearchBlock = config.ai.exaApiKey
      ? `
You also have web search tools available:
- Use the webSearch tool to find information online when the user asks about cited papers, external concepts, related work, or anything not in the document
- Use the extractPage tool to read the full content of a specific URL from search results when you need more detail
- When using web search results, cite the source URLs`
      : ""

    const systemPrompt = `You are an academic assistant helping users understand research papers and documents.
${summaryBlock}
The user has a document loaded and may ask questions about it. When answering:
1. Use the searchDocument tool to find relevant passages from the document
2. Base your answers on the search results
3. Cite page numbers when referencing specific information
4. If the search doesn't return relevant results, say so honestly
5. Be concise and directly answer what was asked
${webSearchBlock}

Do not narrate or announce tool usage. Just use tools silently and provide the answer.`

    const model = models.chatModel()
    const exaApiKey = config.ai.exaApiKey

    const tools: ToolSet = {}
    tools.searchDocument = createSearchTool(
      documentId,
      convex,
      models,
      event,
    ) as unknown as ToolSet[string]

    if (exaApiKey) {
      tools.webSearch = webSearch({
        apiKey: exaApiKey,
        numResults: 10,
        contents: {
          highlights: {
            numSentences: 5,
            highlightsPerUrl: 3,
          },
        },
      }) as unknown as ToolSet[string]
      tools.extractPage = tool({
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
      }) as unknown as ToolSet[string]
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
      providerOptions: models.chatProviderOptions(),
      onError: ({ error }) => {
        activeStreams.delete(threadId)
        emitStreamingEvent(event, {
          status: 500,
          durationMs: Math.round(performance.now() - streamStart),
          error: {
            category: "internal",
            message: error instanceof Error ? error.message : "Chat stream error",
            code: "CHAT_STREAM_ERROR",
          },
        })
      },
      onFinish: async ({
        usage,
        finishReason,
        response,
        text,
        sources,
        steps,
        totalUsage,
      }) => {
        activeStreams.delete(threadId)

        const isFirstMessage = messages.length === 1 && userText !== undefined
        const fallbackTitle = isFirstMessage
          ? userText.slice(0, 20)
          : undefined

        const parts: ChatMessageParts = []
        for (const step of steps) {
          for (const result of step.toolResults) {
            const part = toConvexToolPart(result)
            if (part) parts.push(part)
          }
        }
        parts.push({ type: "text", text })

        try {
          await convex.addAssistantMessage(threadId, parts, fallbackTitle)
        } catch (e) {
          emitStreamingEvent(event, {
            status: 500,
            durationMs: Math.round(performance.now() - streamStart),
            chatSteps: steps.length,
            chatFinishReason: finishReason,
            error: {
              category: "convex",
              message: e instanceof Error ? e.message : String(e),
              code: "CHAT_PERSISTENCE_FAILED",
            },
          } satisfies Partial<WideEvent>)
          return
        }

        // Fire-and-forget: generate LLM title for new threads
        if (isFirstMessage) {
          const titleStart = performance.now()
          const titleEvent: WideEvent = {
            ...event,
            timestamp: new Date().toISOString(),
            method: "BACKGROUND",
            path: "/chat/title",
          }
          Effect.runPromise(
            generateChatTitle(userText, text).pipe(
              Effect.provideService(ModelProvider, models),
            ),
          )
            .then(async (llmTitle) => {
              if (!llmTitle) return
              await convex.updateChatThreadTitle(threadId, llmTitle)
              emitStreamingEvent(titleEvent, {
                status: 200,
                durationMs: Math.round(performance.now() - titleStart),
                titleLength: llmTitle.length,
              })
            })
            .catch((err) =>
              emitStreamingEvent(titleEvent, {
                status: 500,
                durationMs: Math.round(performance.now() - titleStart),
                error: {
                  category: "internal",
                  message: err instanceof Error ? err.message : String(err),
                  code: "CHAT_TITLE_GENERATION_FAILED",
                },
              }),
            )
        }

        emitStreamingEvent(event, {
          status: 200,
          durationMs: Math.round(performance.now() - streamStart),
          chatSteps: steps.length,
          chatFinishReason: finishReason,
        } satisfies Partial<WideEvent>)
      },
    })

    return stream.toUIMessageStreamResponse()
  })
}

function createSearchTool(
  documentId: string,
  convex: ConvexSession,
  models: ModelProviderService,
  event: WideEvent,
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
          generateEmbedding(query).pipe(
            Effect.provideService(ModelProvider, models),
          ),
        )

        const chunks = await convex.searchDocument(
          documentId,
          queryEmbedding,
          5,
        )

        if (!chunks.length) {
          return "No relevant information found in the document."
        }

        return chunks
          .map(
            (c, i) =>
              `[${i + 1}] (Page ${c.page}${c.section ? `, ${c.section}` : ""}): ${c.html}`,
          )
          .join("\n\n")
      } catch (error) {
        event.searchDocumentErrorCount =
          typeof event.searchDocumentErrorCount === "number"
            ? event.searchDocumentErrorCount + 1
            : 1
        event.searchDocumentLastError =
          error instanceof Error ? error.message : String(error)
        return "Search encountered an error. Please try again."
      }
    },
  })
}

type ConvexToolPart = Exclude<ChatMessageParts[number], { type: "text" }>

interface ToolResultForPersistence {
  toolName: string
  toolCallId: string
  input: unknown
  output: unknown
}

function toConvexToolPart(
  result: ToolResultForPersistence,
): ConvexToolPart | null {
  switch (result.toolName) {
    case "searchDocument":
      return {
        type: "tool-searchDocument",
        toolCallId: result.toolCallId,
        state: "output-available",
        input: queryToolInput(result.input),
        output: typeof result.output === "string" ? result.output : "",
      }
    case "webSearch":
      return {
        type: "tool-webSearch",
        toolCallId: result.toolCallId,
        state: "output-available",
        input: queryToolInput(result.input),
        output: stripExaResponse(result.output),
      }
    case "extractPage":
      return {
        type: "tool-extractPage",
        toolCallId: result.toolCallId,
        state: "output-available",
        input: urlToolInput(result.input),
        output: typeof result.output === "string" ? result.output : "",
      }
    default:
      return null
  }
}

function queryToolInput(input: unknown) {
  return {
    query:
      typeof input === "object" &&
      input !== null &&
      "query" in input &&
      typeof input.query === "string"
        ? input.query
        : "",
  }
}

function urlToolInput(input: unknown) {
  return {
    url:
      typeof input === "object" &&
      input !== null &&
      "url" in input &&
      typeof input.url === "string"
        ? input.url
        : "",
  }
}

function extractUserMessage(messages: UIMessage[]): string | undefined {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") return undefined
  const textPart = last.parts.find((p) => p.type === "text")
  return textPart?.type === "text" ? textPart.text : undefined
}

function stripExaResponse(output: unknown) {
  const response = isRecord(output) ? output : {}
  const rawResults = Array.isArray(response.results) ? response.results : []

  return {
    results: rawResults.filter(isRecord).map((result) => ({
      title: stringField(result, "title") ?? "",
      url: stringField(result, "url") ?? "",
      id: stringField(result, "id"),
      publishedDate: stringField(result, "publishedDate"),
      author: stringField(result, "author"),
      image: stringField(result, "image"),
      favicon: stringField(result, "favicon"),
      text: stringField(result, "text"),
      highlights: stringArrayField(result, "highlights"),
      highlightScores: numberArrayField(result, "highlightScores"),
      summary: stringField(result, "summary"),
    })),
    requestId: stringField(response, "requestId"),
    resolvedSearchType: stringField(response, "resolvedSearchType"),
    searchTime: numberField(response, "searchTime"),
    costDollars: fieldOrNull(response, "costDollars"),
    effectiveFilters: fieldOrNull(response, "effectiveFilters"),
    requestTags: fieldOrNull(response, "requestTags"),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "number" ? value : null
}

function stringArrayField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null
}

function numberArrayField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : null
}

function fieldOrNull(record: Record<string, unknown>, key: string) {
  return key in record ? record[key] : null
}
