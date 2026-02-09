import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { AppConfig } from "./config"
import { healthRouter } from "./routes/health"
import { uploadRouter } from "./routes/upload"
import { convertRouter } from "./routes/convert"
import { jobsRouter } from "./routes/jobs"
import { savedDocumentsRouter } from "./routes/saved-documents"
import { downloadRouter } from "./routes/download"
import { chatRouter } from "./routes/chat"
import { documentEmbeddingsRouter } from "./routes/document-embeddings"
import { ttsRouter } from "./routes/tts"

const apiRouter = HttpRouter.empty.pipe(
  HttpRouter.mount("/health", healthRouter),
  HttpRouter.mount("/upload", uploadRouter),
  HttpRouter.mount("/convert", convertRouter),
  HttpRouter.mount("/jobs", jobsRouter),
  HttpRouter.mount("/saved-documents", savedDocumentsRouter),
  HttpRouter.mount("/files", downloadRouter),
  HttpRouter.mount("/chat", chatRouter),
  HttpRouter.mount("/documents", documentEmbeddingsRouter),
  HttpRouter.mount("/tts", ttsRouter),
)

const authProxyApp = Effect.gen(function* () {
  const config = yield* AppConfig
  const request = yield* HttpServerRequest.HttpServerRequest
  const webRequest = yield* HttpServerRequest.toWeb(request)
  const url = new URL(request.url, "http://localhost")
  const targetUrl = `${config.convex.httpUrl}/api/auth${url.pathname}${url.search}`
  const targetHost = new URL(config.convex.httpUrl).host

  const headers = new Headers(request.headers as Record<string, string>)
  headers.set("host", targetHost)

  const cookies = request.cookies
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  if (cookieStr) headers.set("Cookie", cookieStr)

  return yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : webRequest.body,
        redirect: "manual",
        duplex: "half",
      } as RequestInit)
      return HttpServerResponse.fromWeb(response)
    },
    catch: () =>
      HttpServerResponse.json({ error: "Auth service unavailable" }, { status: 502 }),
  })
})

export const app = HttpRouter.empty.pipe(
  HttpRouter.mountApp("/api/auth", authProxyApp as any),
  HttpRouter.mount("/api", apiRouter),
) as any
