/**
 * Document model - business logic for RAG document operations.
 * All functions use requireAuth for Convex-native auth when called by users.
 */

import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import type {
  ChunkInput,
  CreateDocumentInput,
  ThreadAction,
  Toc,
} from "../validators"
import { requireAuth } from "./auth"
import { requireApiToConvexServiceSecret } from "./serverAuth"

export async function createDocument(
  ctx: MutationCtx,
  input: CreateDocumentInput,
) {
  const user = await requireAuth(ctx)

  const documentId = await ctx.db.insert("documents", {
    userId: user._id,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    pageCount: input.pageCount,
    toc: null,
    summary: null,
    color: Math.floor(Math.random() * 12),
  })

  const conversionTaskId = await ctx.db.insert("documentTasks", {
    documentId,
    kind: "conversion",
    status: "pending",
    progress: null,
    error: null,
    conversion: {
      ...input.conversion,
      backendJobId: null,
    },
  })

  return { documentId, conversionTaskId }
}

export async function addChunksToDocumentServer(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  chunks: ChunkInput[],
  apiToConvexServiceSecret: string,
) {
  requireApiToConvexServiceSecret(apiToConvexServiceSecret)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")

  return insertChunks(ctx, documentId, chunks)
}

async function insertChunks(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  chunks: ChunkInput[],
) {
  await Promise.all(
    chunks.map((chunk) =>
      ctx.db.insert("chunks", {
        documentId,
        blockId: chunk.blockId,
        blockType: chunk.blockType,
        html: chunk.html,
        section: chunk.section,
        bbox: chunk.bbox,
        order: chunk.order,
        includeTts: chunk.includeTts,
        ttsText: null,
      }),
    ),
  )

  return { added: chunks.length }
}

export async function updateDocumentTocServer(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  toc: Toc,
  apiToConvexServiceSecret: string,
) {
  requireApiToConvexServiceSecret(apiToConvexServiceSecret)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")

  await ctx.db.patch(documentId, { toc })
  return { updated: true }
}

export async function updateDocumentSummaryServer(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  summary: string,
  apiToConvexServiceSecret: string,
) {
  requireApiToConvexServiceSecret(apiToConvexServiceSecret)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")

  await ctx.db.patch(documentId, { summary })
  return { updated: true }
}

export async function addEmbeddings(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  embeddings: number[][],
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()
  const sortedChunks = chunks.sort((a, b) => a.order - b.order)

  if (sortedChunks.length !== embeddings.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) must match chunk count (${sortedChunks.length})`,
    )
  }

  await Promise.all(
    sortedChunks.map((chunk, i) =>
      ctx.db.patch(chunk._id, { embedding: embeddings[i] }),
    ),
  )

  return { updated: sortedChunks.length }
}

export async function deleteDocument(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  threadAction: ThreadAction,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const [chunks, audioRecords, tasks, threads] = await Promise.all([
    ctx.db
      .query("chunks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect(),
    ctx.db
      .query("ttsAudio")
      .withIndex("by_document_block_voice", (q) => q.eq("documentId", documentId))
      .collect(),
    ctx.db
      .query("documentTasks")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect(),
    ctx.db
      .query("chatThreads")
      .withIndex("by_document", (q) =>
        q.eq("userId", user._id).eq("documentId", documentId),
      )
      .collect(),
  ])

  let threadCount = 0
  let messageCount = 0

  if (threadAction === "delete") {
    for (const thread of threads) {
      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .collect()
      await Promise.all(messages.map((m) => ctx.db.delete(m._id)))
      await ctx.db.delete(thread._id)
      threadCount++
      messageCount += messages.length
    }
  } else {
    await Promise.all(
      threads.map((thread) => ctx.db.patch(thread._id, { documentId: null })),
    )
    threadCount = threads.length
  }

  await Promise.all([
    ...chunks.map((chunk) => ctx.db.delete(chunk._id)),
    ...audioRecords.map((audio) => ctx.db.delete(audio._id)),
    ...tasks.map((task) => ctx.db.delete(task._id)),
  ])

  await ctx.db.delete(documentId)

  return {
    deleted: true,
    chunkCount: chunks.length,
    audioCount: audioRecords.length,
    taskCount: tasks.length,
    threadCount,
    messageCount,
    threadAction,
  }
}

export async function listDocuments(ctx: QueryCtx, limit?: number) {
  const user = await requireAuth(ctx)

  const query = ctx.db
    .query("documents")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .order("desc")

  return limit ? query.take(limit) : query.collect()
}

export async function getDocument(ctx: QueryCtx, documentId: Id<"documents">) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  return doc
}

export async function getChunksForDocument(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  return chunks.sort((a, b) => a.order - b.order)
}

export async function hasEmbeddings(
  ctx: QueryCtx,
  documentId: Id<"documents">,
): Promise<boolean> {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(1)

  return chunks.length > 0 && chunks[0].embedding !== undefined
}

interface ChunkSearchResult {
  html: string
  page: number
  section: string | null
}

export async function searchChunks(
  ctx: ActionCtx,
  args: {
    documentId: Id<"documents">
    queryEmbedding: number[]
    limit?: number
  },
): Promise<ChunkSearchResult[]> {
  const { documentId, queryEmbedding, limit = 5 } = args

  await ctx.runQuery(internal.api.documents.verifyDocumentAccess, {
    documentId,
  })

  const results = await ctx.vectorSearch("chunks", "by_embedding", {
    vector: queryEmbedding,
    limit,
    filter: (q) => q.eq("documentId", documentId),
  })

  const chunks = await Promise.all(
    results.map((r) =>
      ctx.runQuery(internal.api.documents.getChunkInternal, {
        chunkId: r._id,
      }),
    ),
  )

  return chunks
    .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null)
    .map((chunk) => {
      const pageMatch = chunk.blockId.match(/^\/page\/(\d+)\//)
      return {
        html: chunk.html,
        page: pageMatch ? Number(pageMatch[1]) : 0,
        section: chunk.section,
      }
    })
}
