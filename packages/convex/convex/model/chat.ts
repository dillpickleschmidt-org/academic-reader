import type { Infer } from "convex/values"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import type { messagePartValidator } from "../schema"
import { requireAuth } from "./auth"

type MessagePart = Infer<typeof messagePartValidator>

// ===== Mutation Helpers =====

export async function createThread(
  ctx: MutationCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)

  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const now = Date.now()
  return ctx.db.insert("chatThreads", {
    userId: user._id,
    documentId,
    title: null,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteThread(
  ctx: MutationCtx,
  threadId: Id<"chatThreads">,
) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect()

  await Promise.all(messages.map((m) => ctx.db.delete(m._id)))
  await ctx.db.delete(threadId)
}

export async function updateThread(
  ctx: MutationCtx,
  threadId: Id<"chatThreads">,
  fields: {
    title?: string
    isStreaming?: boolean
    updatedAt?: number
  },
) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  await ctx.db.patch(threadId, fields)
}

export async function deleteMessagesFrom(
  ctx: MutationCtx,
  threadId: Id<"chatThreads">,
  messageId: Id<"chatMessages">,
) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .order("asc")
    .collect()

  const targetIndex = messages.findIndex((m) => m._id === messageId)
  if (targetIndex === -1) throw new Error("Message not found")

  const toDelete = messages.slice(targetIndex)
  await Promise.all(toDelete.map((m) => ctx.db.delete(m._id)))
}

export async function addMessage(
  ctx: MutationCtx,
  threadId: Id<"chatThreads">,
  role: "user" | "assistant",
  parts: MessagePart[],
) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  return ctx.db.insert("chatMessages", {
    threadId,
    role,
    parts,
    createdAt: Date.now(),
  })
}

// ===== Query Helpers =====

export async function getThread(ctx: QueryCtx, threadId: Id<"chatThreads">) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  return thread
}

export async function getMessages(ctx: QueryCtx, threadId: Id<"chatThreads">) {
  const user = await requireAuth(ctx)
  const thread = await ctx.db.get(threadId)

  if (!thread) throw new Error("Thread not found")
  if (thread.userId !== user._id) throw new Error("Unauthorized")

  return ctx.db
    .query("chatMessages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .order("asc")
    .collect()
}

export async function listAllThreads(ctx: QueryCtx) {
  const user = await requireAuth(ctx)

  const threads = await ctx.db
    .query("chatThreads")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .order("desc")
    .collect()

  return Promise.all(
    threads.map(async (thread) => {
      const doc = thread.documentId ? await ctx.db.get(thread.documentId) : null
      return {
        ...thread,
        documentColor: doc?.color,
        documentName: doc?.filename,
      }
    }),
  )
}

export async function listThreadsForDocument(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)

  return ctx.db
    .query("chatThreads")
    .withIndex("by_document", (q) =>
      q.eq("userId", user._id).eq("documentId", documentId),
    )
    .order("desc")
    .collect()
}

export async function countThreadsForDocument(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)

  const threads = await ctx.db
    .query("chatThreads")
    .withIndex("by_document", (q) =>
      q.eq("userId", user._id).eq("documentId", documentId),
    )
    .collect()

  return threads.length
}
