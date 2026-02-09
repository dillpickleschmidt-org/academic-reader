import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import type { UIMessage } from "ai"
import { ValidationError } from "@academic-reader/api-client/errors"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"
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
      yield* requireAuth
      const convexService = yield* ConvexClient
      const convex = yield* convexService.fromRequest()
      const request = yield* HttpServerRequest.HttpServerRequest

      const body = (yield* request.json) as ChatRequest
      const { messages, threadId, documentContext } = body

      if (!documentContext?.documentId) {
        return yield* new ValidationError({ message: "documentId is required" })
      }

      if (!threadId) {
        return yield* new ValidationError({ message: "threadId is required" })
      }

      yield* enrichEvent({
        threadId,
        documentId: documentContext.documentId,
        messageCount: messages.length,
      } as Record<string, unknown>)

      const response = yield* runChatStream({
        messages,
        threadId,
        documentId: documentContext.documentId,
        summary: documentContext.summary,
        convex,
      })

      return HttpServerResponse.fromWeb(response)
    }),
  ),
)
