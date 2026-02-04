import { RedisClient } from "bun"

export const redisPub = new RedisClient("redis://redis:6379")

export type StreamMessage =
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }

export function chatStreamChannel(threadId: string) {
  return `chat:stream:${threadId}`
}

export async function publishStreamMessage(
  threadId: string,
  message: StreamMessage,
) {
  await redisPub.publish(chatStreamChannel(threadId), JSON.stringify(message))
}
