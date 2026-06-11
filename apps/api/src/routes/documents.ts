import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { Effect } from "effect"
import { ValidationError } from "@academic-reader/api-client/errors"
import { CreateDocumentRequest } from "@academic-reader/api-client/schemas/document"
import { getVoice } from "@academic-reader/api-client/schemas/tts"
import { AppConfig } from "../config"
import { requireAuth } from "../middleware/auth"
import { getEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { ConvexClient } from "../services/convex-client"
import { ConversionBackend } from "../services/backends/conversion"
import { ModelProvider } from "../services/model-provider"
import { TtsService } from "../services/backends/tts"
import { startDocumentProcessing } from "../processing/document-runner"
import { sanitizeTitle, contentDisposition } from "../utils/sanitize"
import { loadDocumentContent } from "../documents/document-content"
import { deleteDocument } from "../documents/delete-document"
import { extractDocumentPage } from "../documents/document-page"
import { generateDocumentDownload } from "../documents/document-download"
import { generateDocumentEmbeddings } from "../documents/document-embeddings"
import { decodeJsonBody } from "./request-body"

export const documentsRouter = HttpRouter.addAll([
  HttpRouter.route(
    "POST",
    "/api/documents",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      const backend = yield* ConversionBackend
      const convexService = yield* ConvexClient
      const modelProvider = yield* ModelProvider
      const ttsService = yield* TtsService
      const event = yield* getEvent
      const { userId } = yield* requireAuth
      const convex = yield* convexService.userSession()
      const body = yield* decodeJsonBody(CreateDocumentRequest)

      const audioVoiceId =
        config.ttsBackend === "none" ? null : body.audioVoiceId
      if (audioVoiceId && !getVoice(audioVoiceId)) {
        return yield* new ValidationError({
          message: `Unknown voice: ${audioVoiceId}`,
        })
      }

      const conversion = {
        processingMode: body.processingMode,
        useLlm: body.useLlm,
        forceOcr: body.forceOcr,
        pageRange: body.pageRange,
        audioVoiceId,
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          convex.createDocument({
            filename: body.filename,
            mimeType: body.mimeType,
            sizeBytes: body.sizeBytes,
            pageCount: body.pageCount,
            conversion,
          }),
        catch: (e) => e as Error,
      })

      startDocumentProcessing({
        config,
        storage,
        backend,
        serverConvex: convexService.server(),
        modelProvider,
        ttsService,
        event: {
          ...event,
          timestamp: new Date().toISOString(),
          method: "BACKGROUND",
          path: "/documents/process",
          startTimeMs: performance.now(),
          userId,
          documentId: result.documentId,
          fileId: body.fileId,
          filename: body.filename,
          contentType: body.mimeType,
          fileSize: body.sizeBytes,
          conversionBackend: config.conversionBackend,
          ttsBackend: config.ttsBackend,
          ...conversion,
        },
        userId,
        documentId: result.documentId,
        conversionTaskId: result.conversionTaskId,
        fileId: body.fileId,
        filename: body.filename,
        mimeType: body.mimeType,
        ...conversion,
      })

      return HttpServerResponse.jsonUnsafe({
        documentId: result.documentId,
      })
    }),
  ),

  HttpRouter.route(
    "GET",
    "/api/documents/:documentId/content",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const { documentId } = yield* HttpRouter.params
      if (!documentId) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      const result = yield* loadDocumentContent(storage, convex, documentId).pipe(
        Effect.result,
      )
      if (result._tag === "Failure") {
        return HttpServerResponse.jsonUnsafe(
          { error: result.failure.message },
          { status: result.failure.message.includes("not found") ? 404 : 500 },
        )
      }

      return HttpServerResponse.jsonUnsafe(result.success)
    }),
  ),

  HttpRouter.route(
    "DELETE",
    "/api/documents/:documentId",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const backend = yield* ConversionBackend
      const request = yield* HttpServerRequest.HttpServerRequest
      const { documentId } = yield* HttpRouter.params
      if (!documentId) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      const url = new URL(request.url, "http://localhost")
      const threadAction = url.searchParams.get("threadAction")
      if (threadAction !== "keep" && threadAction !== "delete") {
        return HttpServerResponse.jsonUnsafe(
          { error: "threadAction query param required (keep or delete)" },
          { status: 400 },
        )
      }

      const result = yield* deleteDocument({
        storage,
        convex,
        backend,
        documentId,
        threadAction,
      }).pipe(Effect.result)

      if (result._tag === "Failure") {
        return HttpServerResponse.jsonUnsafe(
          { error: "Failed to delete document" },
          { status: 500 },
        )
      }

      return HttpServerResponse.jsonUnsafe(result.success)
    }),
  ),

  HttpRouter.route(
    "GET",
    "/api/documents/:documentId/page/:pageNum",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      const pageNumParam = params.pageNum
      if (!documentId || !pageNumParam) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Missing page parameters" },
          { status: 400 },
        )
      }

      const pageNum = parseInt(pageNumParam, 10)
      if (isNaN(pageNum) || pageNum < 0) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Invalid page number" },
          { status: 400 },
        )
      }

      const result = yield* extractDocumentPage(
        storage,
        convex,
        documentId,
        pageNum,
      ).pipe(Effect.result)
      if (result._tag === "Failure") {
        return HttpServerResponse.jsonUnsafe(
          { error: result.failure.message },
          { status: result.failure.message.includes("range") ? 400 : 404 },
        )
      }

      return HttpServerResponse.uint8Array(result.success, {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=3600",
        },
      })
    }),
  ),

  HttpRouter.route(
    "GET",
    "/api/documents/:documentId/download",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const params = yield* HttpRouter.params
      const request = yield* HttpServerRequest.HttpServerRequest
      const documentId = params.documentId
      if (!documentId) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      const url = new URL(request.url, "http://localhost")
      const title = sanitizeTitle(url.searchParams.get("title") || "")
      const tabIndent = url.searchParams.get("tabIndent") !== "off"

      const result = yield* generateDocumentDownload({
        storage,
        convex,
        documentId,
        title,
        tabIndent,
      }).pipe(Effect.result)
      if (result._tag === "Failure") {
        return HttpServerResponse.jsonUnsafe(
          { error: "Failed to generate download" },
          { status: 500 },
        )
      }

      return HttpServerResponse.uint8Array(
        new TextEncoder().encode(result.success),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": contentDisposition(`${title || "document"}.html`),
          },
        },
      )
    }),
  ),

  HttpRouter.route(
    "POST",
    "/api/documents/:documentId/embeddings",
    Effect.gen(function* () {
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      if (!documentId) {
        return HttpServerResponse.jsonUnsafe(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      const result = yield* generateDocumentEmbeddings(convex, documentId).pipe(
        Effect.result,
      )
      if (result._tag === "Failure") {
        return HttpServerResponse.jsonUnsafe(
          { error: result.failure.message },
          { status: result.failure.message.includes("No chunks") ? 404 : 500 },
        )
      }

      return HttpServerResponse.jsonUnsafe(result.success)
    }),
  ),
])
