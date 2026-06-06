import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import * as mupdf from "mupdf"
import { enrichEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { ConvexClient } from "../services/convex-client"
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"

export const savedDocumentsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/:documentId",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      if (!documentId) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      yield* enrichEvent({ documentId })

      const convex = yield* convexService.userSession()

      const doc = yield* Effect.tryPromise({
        try: () => convex.getDocument(documentId),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (!doc) {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const htmlPath = `documents/${doc.userId}/${doc.storageId}/content.html`
      const mdPath = `documents/${doc.userId}/${doc.storageId}/content.md`

      const [htmlResult, mdResult, chunksResult] = yield* Effect.all(
        [
          storage.readFileAsString(htmlPath).pipe(Effect.either),
          storage.readFileAsString(mdPath).pipe(Effect.either),
          Effect.tryPromise({
            try: () => convex.getDocumentChunks(documentId),
            catch: () => [],
          }).pipe(Effect.catchAll(() => Effect.succeed([]))),
        ],
        { concurrency: "unbounded" },
      )

      if (htmlResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const html = htmlResult.right
      const markdown = mdResult._tag === "Right" ? mdResult.right : ""
      const chunks = chunksResult

      const enhancedHtml = processHtml(html, HTML_TRANSFORMS)

      return HttpServerResponse.unsafeJson({
        html: enhancedHtml,
        markdown,
        storageId: doc.storageId,
        chunks,
        toc: doc.toc,
        documentId,
      })
    }),
  ),

  HttpRouter.del(
    "/:documentId",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const request = yield* HttpServerRequest.HttpServerRequest
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      if (!documentId) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }

      yield* enrichEvent({ documentId })

      const url = new URL(request.url, "http://localhost")
      const threadAction = url.searchParams.get("threadAction")

      if (threadAction !== "keep" && threadAction !== "delete") {
        return HttpServerResponse.unsafeJson(
          { error: "threadAction query param required (keep or delete)" },
          { status: 400 },
        )
      }

      const convex = yield* convexService.userSession()

      const doc = yield* Effect.tryPromise({
        try: () => convex.getDocument(documentId),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (!doc) {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const removeResult = yield* Effect.tryPromise({
        try: () => convex.removeDocument(documentId, threadAction),
        catch: (e) => e,
      }).pipe(Effect.either)

      if (removeResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Failed to delete document" },
          { status: 500 },
        )
      }

      const folderPrefix = `documents/${doc.userId}/${doc.storageId}/`
      yield* storage.deletePrefix(folderPrefix).pipe(Effect.ignore)

      return HttpServerResponse.unsafeJson({ success: true })
    }),
  ),

  HttpRouter.get(
    "/:documentId/page/:pageNum",
    Effect.gen(function* () {
      const storage = yield* Storage
      const convexService = yield* ConvexClient
      const params = yield* HttpRouter.params
      const documentId = params.documentId
      const pageNumParam = params.pageNum
      if (!documentId) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing documentId" },
          { status: 400 },
        )
      }
      if (!pageNumParam) {
        return HttpServerResponse.unsafeJson(
          { error: "Missing page number" },
          { status: 400 },
        )
      }

      const pageNum = parseInt(pageNumParam, 10)

      if (isNaN(pageNum) || pageNum < 0) {
        return HttpServerResponse.unsafeJson(
          { error: "Invalid page number" },
          { status: 400 },
        )
      }

      const convex = yield* convexService.userSession()

      const doc = yield* Effect.tryPromise({
        try: () => convex.getDocument(documentId),
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (!doc) {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const pdfPath = `documents/${doc.userId}/${doc.storageId}/original.pdf`

      const pdfResult = yield* storage.readFile(pdfPath).pipe(Effect.either)
      if (pdfResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "PDF not found" },
          { status: 404 },
        )
      }

      const pdfBuffer = pdfResult.right
      const srcDoc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
      try {
        const pageCount = srcDoc.countPages()
        if (pageNum >= pageCount) {
          return HttpServerResponse.unsafeJson(
            { error: "Page number out of range" },
            { status: 400 },
          )
        }

        const destDoc = new mupdf.PDFDocument()
        const srcPdf = srcDoc.asPDF()
        if (!srcPdf) {
          return HttpServerResponse.unsafeJson(
            { error: "Not a valid PDF" },
            { status: 400 },
          )
        }

        destDoc.graftPage(0, srcPdf, pageNum)
        const pdfOutput = destDoc.saveToBuffer()
        destDoc.destroy()

        return HttpServerResponse.uint8Array(pdfOutput.asUint8Array(), {
          headers: {
            "Content-Type": "application/pdf",
            "Cache-Control": "private, max-age=3600",
          },
        })
      } finally {
        srcDoc.destroy()
      }
    }),
  ),
)
