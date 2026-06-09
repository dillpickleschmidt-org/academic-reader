import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import { requireAuth } from "../middleware/auth"
import { Storage } from "../services/storage"
import { ConvexClient } from "../services/convex-client"
import { imageKey, type DocumentLocation } from "../documents/document-storage"

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  wav: "audio/wav",
}

export const assetsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/documents/:documentId/images/:filename",
    Effect.gen(function* () {
      const { userId } = yield* requireAuth
      const storage = yield* Storage
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      const filename = params.filename
      if (!documentId || !filename) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing asset path" },
          { status: 400 },
        )
      }

      const location: DocumentLocation = { userId, documentId }
      const result = yield* storage.readFile(imageKey(location, filename)).pipe(Effect.either)
      if (result._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Asset not found" },
          { status: 404 },
        )
      }

      return HttpServerResponse.uint8Array(result.right, {
        headers: assetHeaders(filename),
      })
    }),
  ),

  HttpRouter.get(
    "/documents/:documentId/audio",
    Effect.gen(function* () {
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const storage = yield* Storage
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://localhost")
      const blockId = url.searchParams.get("blockId")
      const voiceId = url.searchParams.get("voiceId")
      if (!documentId || !blockId || !voiceId) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing audio parameters" },
          { status: 400 },
        )
      }

      const audio = yield* Effect.tryPromise({
        try: () => convex.getBlockAudio(documentId, blockId, voiceId),
        catch: (e) => e as Error,
      })
      if (!audio) {
        return HttpServerResponse.unsafeJson(
          { error: "Audio not found" },
          { status: 404 },
        )
      }

      const result = yield* storage.readFile(audio.storagePath).pipe(Effect.either)
      if (result._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Audio not found" },
          { status: 404 },
        )
      }

      return HttpServerResponse.uint8Array(result.right, {
        headers: assetHeaders("audio.wav"),
      })
    }),
  ),
)

function assetHeaders(filename: string) {
  return {
    "Content-Type": contentType(filename),
    "Cache-Control": "private, max-age=31536000, immutable",
  }
}

function contentType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return MIME_TYPES[ext] ?? "application/octet-stream"
}
