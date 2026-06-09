import type { Doc, Id } from "@academic-reader/convex/convex/_generated/dataModel"
import type { ConvexServerSession } from "../services/convex-client"

type DocumentTaskKind = Doc<"documentTasks">["kind"]
type OptionalDocumentTaskKind = Exclude<DocumentTaskKind, "conversion">
type DocumentTaskProgress = Doc<"documentTasks">["progress"]
type ConversionDetails = NonNullable<Doc<"documentTasks">["conversion"]>

export interface DocumentTaskWriter {
  createRunningTask(kind: OptionalDocumentTaskKind): Promise<Id<"documentTasks">>
  startConversion(conversion: ConversionDetails): Promise<void>
  setConversionBackendJob(conversion: ConversionDetails): Promise<void>
  setProgress(taskId: string, progress: DocumentTaskProgress): Promise<void>
  succeed(taskId: string): Promise<void>
  fail(taskId: string, error: unknown): Promise<void>
}

export function createDocumentTaskWriter(
  convex: ConvexServerSession,
  documentId: string,
  conversionTaskId: string,
): DocumentTaskWriter {
  return {
    createRunningTask: (kind) =>
      convex.createDocumentTask({
        documentId,
        kind,
        status: "running",
        progress: null,
        error: null,
        conversion: null,
      }),
    startConversion: (conversion) =>
      convex.updateDocumentTask(conversionTaskId, {
        status: "running",
        progress: { label: "Preparing file", current: 0, total: 0 },
        error: null,
        conversion,
      }).then(() => undefined),
    setConversionBackendJob: (conversion) =>
      convex.updateDocumentTask(conversionTaskId, {
        progress: { label: "Queued", current: 0, total: 0 },
        conversion,
      }).then(() => undefined),
    setProgress: (taskId, progress) =>
      convex.updateDocumentTask(taskId, { progress }).then(() => undefined),
    succeed: (taskId) =>
      convex.updateDocumentTask(taskId, {
        status: "succeeded",
        progress: null,
        error: null,
      }).then(() => undefined),
    fail: (taskId, error) =>
      convex.updateDocumentTask(taskId, {
        status: "failed",
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      }).then(() => undefined),
  }
}

export async function runTrackedTask(
  writer: DocumentTaskWriter,
  kind: OptionalDocumentTaskKind,
  run: (taskId: Id<"documentTasks">) => Promise<void>,
  callbacks: {
    onFailure?: (taskId: Id<"documentTasks">, error: unknown) => void
  } = {},
) {
  const taskId = await writer.createRunningTask(kind)
  try {
    await run(taskId)
    await writer.succeed(taskId)
  } catch (error) {
    await writer.fail(taskId, error)
    callbacks.onFailure?.(taskId, error)
  }
}
