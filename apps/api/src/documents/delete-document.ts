import { Effect } from "effect"
import type { ConversionBackendService } from "../services/backends/conversion"
import type { ConvexSession } from "../services/convex-client"
import type { StorageService } from "../services/storage"
import { documentLocation, documentPrefix } from "./document-storage"

export function deleteDocument(options: {
  storage: StorageService
  convex: ConvexSession
  backend: ConversionBackendService
  documentId: string
  threadAction: "keep" | "delete"
}) {
  return Effect.gen(function* () {
    const [doc, tasks] = yield* Effect.all([
      Effect.tryPromise({
        try: () => options.convex.getDocument(options.documentId),
        catch: (e) => e as Error,
      }),
      Effect.tryPromise({
        try: () => options.convex.listDocumentTasks(options.documentId),
        catch: (e) => e as Error,
      }),
    ])

    const conversionTask = tasks.find((task) => task.kind === "conversion")
    const backendJobId = conversionTask?.conversion?.backendJobId
    if (backendJobId && options.backend.supportsCancellation()) {
      yield* options.backend.cancelJob(backendJobId).pipe(Effect.ignore)
    }

    yield* Effect.tryPromise({
      try: () => options.convex.removeDocument(options.documentId, options.threadAction),
      catch: (e) => e as Error,
    })

    yield* options.storage
      .deletePrefix(`${documentPrefix(documentLocation(doc, options.documentId))}/`)
      .pipe(Effect.ignore)

    return { success: true }
  })
}
