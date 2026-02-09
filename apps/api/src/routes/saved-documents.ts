import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import * as mupdf from "mupdf"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"
import { ConvexHttpClient } from "convex/browser"
import { getToken } from "@convex-dev/better-auth/utils"

export const savedDocumentsRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/:documentId", Effect.gen(function* () {
    const { userId } = yield* requireAuth
    const config = yield* AppConfig
    const storage = yield* Storage
    const request = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const documentId = params.documentId

    yield* enrichEvent({ documentId } as Record<string, unknown>)

    const convex = yield* createConvexClient(config, request)
    if (!convex) {
      return HttpServerResponse.unsafeJson({ error: "Authentication failed" }, { status: 401 })
    }

    const doc = yield* Effect.tryPromise({
      try: () => convex.query("api/documents:get" as any, { documentId }),
      catch: () => null,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (!doc) {
      return HttpServerResponse.unsafeJson({ error: "Document not found" }, { status: 404 })
    }

    const storageId = (doc as any).storageId
    const toc = (doc as any).toc

    const htmlPath = `documents/${userId}/${storageId}/content.html`
    const mdPath = `documents/${userId}/${storageId}/content.md`

    const [htmlResult, mdResult, chunksResult] = yield* Effect.all([
      storage.readFileAsString(htmlPath).pipe(Effect.either),
      storage.readFileAsString(mdPath).pipe(Effect.either),
      Effect.tryPromise({
        try: () => convex.query("api/documents:getChunks" as any, { documentId }),
        catch: () => [],
      }).pipe(Effect.catchAll(() => Effect.succeed([]))),
    ], { concurrency: "unbounded" })

    if (htmlResult._tag === "Left") {
      return HttpServerResponse.unsafeJson({ error: "Document not found" }, { status: 404 })
    }

    const html = htmlResult.right
    const markdown = mdResult._tag === "Right" ? mdResult.right : ""
    const chunks = chunksResult

    const enhancedHtml = processHtml(html, HTML_TRANSFORMS)

    return HttpServerResponse.unsafeJson({
      html: enhancedHtml,
      markdown,
      storageId,
      chunks,
      toc,
      documentId,
    })
  })),

  HttpRouter.del("/:documentId", Effect.gen(function* () {
    const { userId } = yield* requireAuth
    const config = yield* AppConfig
    const storage = yield* Storage
    const request = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const documentId = params.documentId

    yield* enrichEvent({ documentId } as Record<string, unknown>)

    const url = new URL(request.url, "http://localhost")
    const threadAction = url.searchParams.get("threadAction")

    if (threadAction !== "keep" && threadAction !== "delete") {
      return HttpServerResponse.unsafeJson(
        { error: "threadAction query param required (keep or delete)" },
        { status: 400 },
      )
    }

    const convex = yield* createConvexClient(config, request)
    if (!convex) {
      return HttpServerResponse.unsafeJson({ error: "Authentication failed" }, { status: 401 })
    }

    const doc = yield* Effect.tryPromise({
      try: () => convex.query("api/documents:get" as any, { documentId }),
      catch: () => null,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (!doc) {
      return HttpServerResponse.unsafeJson({ error: "Document not found" }, { status: 404 })
    }

    const storageId = (doc as any).storageId

    const removeResult = yield* Effect.tryPromise({
      try: () => convex.mutation("api/documents:remove" as any, { documentId, threadAction }),
      catch: (e) => e,
    }).pipe(Effect.either)

    if (removeResult._tag === "Left") {
      return HttpServerResponse.unsafeJson({ error: "Failed to delete document" }, { status: 500 })
    }

    const folderPrefix = `documents/${userId}/${storageId}/`
    yield* storage.deletePrefix(folderPrefix).pipe(Effect.ignore)

    return HttpServerResponse.unsafeJson({ success: true })
  })),

  HttpRouter.get("/:documentId/page/:pageNum", Effect.gen(function* () {
    const { userId } = yield* requireAuth
    const config = yield* AppConfig
    const storage = yield* Storage
    const request = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const documentId = params.documentId
    const pageNum = parseInt(params.pageNum!, 10)

    if (isNaN(pageNum) || pageNum < 0) {
      return HttpServerResponse.unsafeJson({ error: "Invalid page number" }, { status: 400 })
    }

    const convex = yield* createConvexClient(config, request)
    if (!convex) {
      return HttpServerResponse.unsafeJson({ error: "Authentication failed" }, { status: 401 })
    }

    const doc = yield* Effect.tryPromise({
      try: () => convex.query("api/documents:get" as any, { documentId }),
      catch: () => null,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (!doc) {
      return HttpServerResponse.unsafeJson({ error: "Document not found" }, { status: 404 })
    }

    const storageId = (doc as any).storageId
    const pdfPath = `documents/${userId}/${storageId}/original.pdf`

    const pdfResult = yield* storage.readFile(pdfPath).pipe(Effect.either)
    if (pdfResult._tag === "Left") {
      return HttpServerResponse.unsafeJson({ error: "PDF not found" }, { status: 404 })
    }

    const pdfBuffer = pdfResult.right
    const srcDoc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
    try {
      const pageCount = srcDoc.countPages()
      if (pageNum >= pageCount) {
        return HttpServerResponse.unsafeJson({ error: "Page number out of range" }, { status: 400 })
      }

      const destDoc = new mupdf.PDFDocument()
      const srcPdf = srcDoc.asPDF()
      if (!srcPdf) {
        return HttpServerResponse.unsafeJson({ error: "Not a valid PDF" }, { status: 400 })
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
  })),
)

function createConvexClient(
  config: { convex: { httpUrl: string; siteUrl: string } },
  request: { cookies: Record<string, string> },
) {
  return Effect.tryPromise({
    try: async () => {
      const headers = new Headers()
      const cookieStr = Object.entries(request.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
      if (cookieStr) headers.set("Cookie", cookieStr)

      const { token } = await getToken(config.convex.httpUrl, headers)
      if (!token) return null

      const client = new ConvexHttpClient(config.convex.siteUrl)
      client.setAuth(token)
      return client
    },
    catch: () => null as never,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
}
