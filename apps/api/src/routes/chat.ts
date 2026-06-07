import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import type { UIMessage } from "ai"
import { ValidationError } from "@academic-reader/api-client/errors"
import { getEvent, emitStreamingEvent } from "../middleware/wide-event"
import { ConvexClient } from "../services/convex-client"
import { runChatStream } from "../services/ai/chat-agent"

interface ChatRequest {
  messages: UIMessage[]
  threadId: string
  documentContext?: {
    documentId?: string
    summary?: string
  }
}

export const chatRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/",
    Effect.gen(function* () {
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const request = yield* HttpServerRequest.HttpServerRequest
      const event = yield* getEvent

      const body = (yield* request.json) as ChatRequest
      const { messages, threadId, documentContext } = body

      if (!documentContext?.documentId) {
        emitStreamingEvent(event, { status: 400 })
        return yield* new ValidationError({ message: "documentId is required" })
      }

      if (!threadId) {
        emitStreamingEvent(event, { status: 400 })
        return yield* new ValidationError({ message: "threadId is required" })
      }

      Object.assign(event, {
        threadId,
        documentId: documentContext.documentId,
        messageCount: messages.length,
      })

      const responseResult = yield* Effect.either(
        runChatStream({
          messages,
          threadId,
          documentId: documentContext.documentId,
          summary: documentContext.summary,
          convex,
          event,
        }),
      )

      if (responseResult._tag === "Left") {
        emitStreamingEvent(event, {
          status: 500,
          error: {
            category: "internal",
            message:
              responseResult.left instanceof Error
                ? responseResult.left.message
                : String(responseResult.left),
            code: "CHAT_STREAM_START_FAILED",
          },
        })
        return HttpServerResponse.unsafeJson(
          { error: "Failed to start chat stream" },
          { status: 500 },
        )
      }

      return HttpServerResponse.fromWeb(responseResult.right)
    }),
  ),
)
