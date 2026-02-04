import { Hono } from "hono"
import { RedisClient } from "bun"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { chatStreamChannel, type StreamMessage } from "../services/redis"

type Variables = {
  userId: string
}

export const chatStream = new Hono<{ Variables: Variables }>()

chatStream.use("/chat/stream/:threadId", requireAuth)

chatStream.get("/chat/stream/:threadId", async (c) => {
  const threadId = c.req.param("threadId")

  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    return c.json({ error: "Authentication failed" }, 401)
  }

  // Verify user owns the thread
  try {
    await convex.query(api.api.chat.getThread, {
      threadId: threadId as Id<"chatThreads">,
    })
  } catch {
    return c.json({ error: "Thread not found or unauthorized" }, 404)
  }

  const subscriber = new RedisClient("redis://redis:6379")
  const channel = chatStreamChannel(threadId)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      await subscriber.subscribe(channel, (message: string) => {
        send(message)

        try {
          const parsed = JSON.parse(message) as StreamMessage
          if (parsed.type === "done" || parsed.type === "error") {
            subscriber.unsubscribe(channel)
            controller.close()
          }
        } catch {
          // Not valid JSON, forward as-is
        }
      })
    },
    cancel() {
      subscriber.unsubscribe(channel)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
})
