import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import { messagePartValidator } from "../validators"
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

export const deleteMessagesFrom = mutation({
  args: {
    threadId: v.id("chatThreads"),
    messageId: v.id("chatMessages"),
  },
  handler: (ctx, { threadId, messageId }) =>
    Chat.deleteMessagesFrom(ctx, threadId, messageId),
})

export const addUserMessage = mutation({
  args: {
    threadId: v.id("chatThreads"),
    parts: v.array(messagePartValidator),
  },
  handler: async (ctx, { threadId, parts }) => {
    await Chat.addMessage(ctx, threadId, "user", parts)
    await Chat.updateThread(ctx, threadId, { updatedAt: Date.now() })
  },
})

export const addAssistantMessage = mutation({
  args: {
    threadId: v.id("chatThreads"),
    parts: v.array(messagePartValidator),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, parts, title }) => {
    await Chat.addMessage(ctx, threadId, "assistant", parts)
    await Chat.updateThread(ctx, threadId, {
      updatedAt: Date.now(),
      ...(title !== undefined && { title }),
    })
  },
})

export const updateThreadTitle = mutation({
  args: {
    threadId: v.id("chatThreads"),
    title: v.string(),
  },
  handler: (ctx, { threadId, title }) =>
    Chat.updateThread(ctx, threadId, { title }),
})

// ===== Queries =====

export const getThreadMessages = query({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: (ctx, { threadId }) => Chat.getMessages(ctx, threadId),
})

export const listAllThreads = query({
  args: {},
  handler: (ctx) => Chat.listAllThreads(ctx),
})

export const listThreadsForDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    Chat.listThreadsForDocument(ctx, documentId),
})

export const countThreadsForDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    Chat.countThreadsForDocument(ctx, documentId),
})
