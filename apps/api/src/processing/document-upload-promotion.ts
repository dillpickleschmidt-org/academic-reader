import { Effect } from "effect"
import type { StorageService } from "../services/storage"
import type { DocumentLocation } from "../documents/document-storage"
import { documentPrefix, tempDocumentPrefix } from "../documents/document-storage"

export function promoteUploadedFile(
  storage: StorageService,
  location: DocumentLocation,
  fileId: string,
) {
  return Effect.gen(function* () {
    const copied = yield* storage.copyPrefix(
      `${tempDocumentPrefix(fileId)}/`,
      `${documentPrefix(location)}/`,
    )

    if (copied === 0) {
      return yield* Effect.fail(new Error("Uploaded file not found"))
    }

    yield* storage.deletePrefix(`${tempDocumentPrefix(fileId)}/`)
  })
}
