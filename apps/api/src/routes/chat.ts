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

      const response = yield* runChatStream({
        messages,
        threadId,
        documentId: documentContext.documentId,
        summary: documentContext.summary,
        convex,
        event,
      })

      return HttpServerResponse.fromWeb(response)
    }),
  ),
)
