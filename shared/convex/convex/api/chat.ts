import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import * as Chat from "../model/chat"

// ===== Mutations =====

export const createThread = mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Chat.createThread(ctx, documentId),
})

export const deleteThread = mutation({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: (ctx, { threadId }) => Chat.deleteThread(ctx, threadId),
})

export const setStreaming = mutation({
  args: {
    threadId: v.id("chatThreads"),
    isStreaming: v.boolean(),
  },
  handler: (ctx, { threadId, isStreaming }) =>
    Chat.updateThread(ctx, threadId, { isStreaming }),
})

export const addMessageAndStartStreaming = mutation({
  args: {
    threadId: v.id("chatThreads"),
    content: v.string(),
  },
  handler: async (ctx, { threadId, content }) => {
    await Chat.addMessage(ctx, threadId, "user", content)
    await Chat.updateThread(ctx, threadId, {
      updatedAt: Date.now(),
      isStreaming: true,
    })
  },
})

export const finishStreaming = mutation({
  args: {
    threadId: v.id("chatThreads"),
    assistantContent: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, assistantContent, title }) => {
    await Chat.addMessage(ctx, threadId, "assistant", assistantContent)
    await Chat.updateThread(ctx, threadId, {
      updatedAt: Date.now(),
      isStreaming: false,
      ...(title !== undefined && { title }),
    })
  },
})

// ===== Queries =====

export const listThreads = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) => Chat.listThreads(ctx, documentId),
})

export const getThread = query({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: (ctx, { threadId }) => Chat.getThread(ctx, threadId),
})

export const listMessages = query({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: (ctx, { threadId }) => Chat.getMessages(ctx, threadId),
})
