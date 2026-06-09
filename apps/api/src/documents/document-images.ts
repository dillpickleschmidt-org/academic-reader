import { Effect } from "effect"
import type { StorageService } from "../services/storage"
import type { DocumentLocation } from "./document-storage"
import { imageKey, imageUrl } from "./document-storage"

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

export function saveDocumentImages(
  storage: StorageService,
  location: DocumentLocation,
  images: Record<string, string>,
) {
  return Effect.gen(function* () {
    const entries = yield* Effect.all(
      Object.entries(images).map(([filename, base64Data]) =>
        Effect.gen(function* () {
          const ext = filename.split(".").pop()?.toLowerCase() ?? "png"
          yield* storage.saveFile(
            imageKey(location, filename),
            Buffer.from(base64Data, "base64"),
            {
              contentType: IMAGE_MIME_TYPES[ext] ?? "image/png",
              cacheControl: "private, max-age=31536000, immutable",
            },
          )
          return [
            filename,
            imageUrl(location.documentId, filename),
          ] as const
        }),
      ),
      { concurrency: "unbounded" },
    )
    return Object.fromEntries(entries)
  })
}

export function imageMimeType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "png"
  return IMAGE_MIME_TYPES[ext] ?? "image/png"
}
