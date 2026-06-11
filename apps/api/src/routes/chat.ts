import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { Effect, Schema } from "effect"
import type { UIMessage } from "ai"
import { ValidationError } from "@academic-reader/api-client/errors"
import { getEvent, emitStreamingEvent } from "../middleware/wide-event"
import { ConvexClient } from "../services/convex-client"
import { runChatStream } from "../services/ai/chat-agent"
import { decodeJsonBody } from "./request-body"

const ChatRequest = Schema.Struct({
  messages: Schema.Array(Schema.Unknown),
  threadId: Schema.String,
  documentContext: Schema.optional(
    Schema.Struct({
      documentId: Schema.String,
      summary: Schema.NullOr(Schema.String),
    }),
  ),
})

export const chatRouter = HttpRouter.add(
  "POST",
  "/api/chat",
  Effect.gen(function* () {
    const convexService = yield* ConvexClient
    const convex = yield* convexService.userSession()
    const event = yield* getEvent

    const body = yield* decodeJsonBody(ChatRequest)
    const messages = body.messages as UIMessage[]
    const { threadId, documentContext } = body
    event.startTimeMs = performance.now()
    Object.assign(event, {
      threadId,
      documentId: documentContext?.documentId,
      messageCount: messages.length,
    })

    if (!documentContext || !documentContext.documentId) {
      Object.assign(event, {
        status: 400,
        error: {
          category: "validation",
          message: "documentId is required",
          code: "MISSING_DOCUMENT_ID",
        },
      })
      emitStreamingEvent(event)
      return yield* new ValidationError({ message: "documentId is required" })
    }

    if (!threadId) {
      Object.assign(event, {
        status: 400,
        error: {
          category: "validation",
          message: "threadId is required",
          code: "MISSING_THREAD_ID",
        },
      })
      emitStreamingEvent(event)
      return yield* new ValidationError({ message: "threadId is required" })
    }

    const responseResult = yield* Effect.result(
      runChatStream({
        messages,
        threadId,
        documentId: documentContext.documentId,
        summary: documentContext.summary ?? null,
        convex,
        event,
      }),
    )

    if (responseResult._tag === "Failure") {
      emitStreamingEvent(event, {
        status: 500,
        error: {
          category: "internal",
          message:
            responseResult.failure instanceof Error
              ? responseResult.failure.message
              : String(responseResult.failure),
          code: "CHAT_STREAM_START_FAILED",
        },
      })
      return HttpServerResponse.jsonUnsafe(
        { error: "Failed to start chat stream" },
        { status: 500 },
      )
    }

    return HttpServerResponse.fromWeb(responseResult.success)
  }),
)
