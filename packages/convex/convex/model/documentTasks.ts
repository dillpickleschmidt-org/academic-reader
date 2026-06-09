import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import type {
  ConversionTaskMetadata,
  DocumentTaskKind,
  DocumentTaskProgress,
  DocumentTaskStatus,
} from "../validators"
import { requireAuth } from "./auth"
import { requireApiToConvexServiceSecret } from "./serverAuth"

type TaskStatus = DocumentTaskStatus
type TaskProgress = DocumentTaskProgress | null
type ConversionTask = ConversionTaskMetadata | null

interface TaskPatch {
  status?: TaskStatus
  progress?: TaskProgress
  error?: string | null
  conversion?: ConversionTask
}

export async function listForDocument(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const tasks = await ctx.db
    .query("documentTasks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  return sortDocumentTasks(tasks)
}

export async function createForDocumentServer(
  ctx: MutationCtx,
  input: {
    documentId: Id<"documents">
    kind: DocumentTaskKind
    status: TaskStatus
    progress: TaskProgress
    error: string | null
    conversion: ConversionTask
    apiToConvexServiceSecret: string
  },
) {
  requireApiToConvexServiceSecret(input.apiToConvexServiceSecret)
  const doc = await ctx.db.get(input.documentId)
  if (!doc) throw new Error("Document not found")

  return ctx.db.insert("documentTasks", {
    documentId: input.documentId,
    kind: input.kind,
    status: input.status,
    progress: input.progress,
    error: input.error,
    conversion: input.conversion,
  })
}

export async function updateTaskServer(
  ctx: MutationCtx,
  taskId: Id<"documentTasks">,
  patch: TaskPatch & { apiToConvexServiceSecret: string },
) {
  requireApiToConvexServiceSecret(patch.apiToConvexServiceSecret)
  const task = await ctx.db.get(taskId)
  if (!task) throw new Error("Task not found")
  const doc = await ctx.db.get(task.documentId)
  if (!doc) throw new Error("Document not found")

  const { apiToConvexServiceSecret: _secret, ...taskPatch } = patch
  return patchTask(ctx, task, taskPatch)
}

async function patchTask(
  ctx: MutationCtx,
  task: Doc<"documentTasks">,
  patch: TaskPatch,
) {
  const next: TaskPatch = {}

  if (patch.status !== undefined && patch.status !== task.status) {
    next.status = patch.status
  }
  if (patch.progress !== undefined && !sameProgress(patch.progress, task.progress)) {
    next.progress = patch.progress
  }
  if (patch.error !== undefined && patch.error !== task.error) {
    next.error = patch.error
  }
  if (patch.conversion !== undefined && !sameConversion(patch.conversion, task.conversion)) {
    next.conversion = patch.conversion
  }

  if (Object.keys(next).length === 0) return { updated: false }

  await ctx.db.patch(task._id, next)
  return { updated: true }
}

function sameConversion(a: ConversionTask, b: ConversionTask) {
  if (a === b) return true
  if (a === null || b === null) return a === b
  return (
    a.processingMode === b.processingMode &&
    a.useLlm === b.useLlm &&
    a.forceOcr === b.forceOcr &&
    a.pageRange === b.pageRange &&
    a.audioVoiceId === b.audioVoiceId &&
    a.backendJobId === b.backendJobId
  )
}

function sortDocumentTasks(tasks: Doc<"documentTasks">[]) {
  const order: Record<DocumentTaskKind, number> = {
    conversion: 0,
    toc: 1,
    summary: 2,
    "tts-prep": 3,
    "tts-audio": 4,
  }
  return tasks.sort((a, b) => order[a.kind] - order[b.kind])
}

function sameProgress(a: TaskProgress, b: TaskProgress) {
  if (a === null || b === null) return a === b
  return a.label === b.label && a.current === b.current && a.total === b.total
}
