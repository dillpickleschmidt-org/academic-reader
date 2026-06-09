import { Effect } from "effect"
import type { StorageService } from "../services/storage"
import type { DocumentLocation } from "../documents/document-storage"
import { documentPrefix, tempDocumentPrefix } from "../documents/document-storage"

export async function promoteUploadedFile(
  storage: StorageService,
  location: DocumentLocation,
  fileId: string,
) {
  const copied = await Effect.runPromise(
    storage.copyPrefix(
      `${tempDocumentPrefix(fileId)}/`,
      `${documentPrefix(location)}/`,
    ),
  )

  if (copied === 0) {
    throw new Error("Uploaded file not found")
  }

  await Effect.runPromise(storage.deletePrefix(`${tempDocumentPrefix(fileId)}/`))
}
