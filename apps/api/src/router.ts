import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import { resolve, join } from "path"
import { statSync } from "fs"
import { healthRouter } from "./routes/health"
import { uploadRouter } from "./routes/upload"
import { convertRouter } from "./routes/convert"
import { jobsRouter } from "./routes/jobs"
import { savedDocumentsRouter } from "./routes/saved-documents"
import { downloadRouter } from "./routes/download"
import { chatRouter } from "./routes/chat"
import { documentEmbeddingsRouter } from "./routes/document-embeddings"
import { ttsRouter } from "./routes/tts"
import { runtimeConfigRouter } from "./routes/runtime-config"
import { assetsRouter } from "./routes/assets"

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
  HttpRouter.mount("/runtime-config", runtimeConfigRouter),
  HttpRouter.mount("/assets", assetsRouter),
)

const STATIC_DIR = resolve(import.meta.dirname, "../../web/dist")

const serveStaticApp = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const url = new URL(request.url, "http://localhost")
  const pathname = decodeURIComponent(url.pathname)

  const filePath = join(STATIC_DIR, pathname)
  if (!filePath.startsWith(STATIC_DIR)) {
    return HttpServerResponse.text("Forbidden", { status: 403 })
  }

  let isFile = false
  try { isFile = statSync(filePath).isFile() } catch {}

  const target = isFile ? filePath : join(STATIC_DIR, "index.html")
  return yield* HttpServerResponse.file(target).pipe(
    Effect.catchAll(() =>
      Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 })),
    ),
  )
})

export const app = HttpRouter.empty.pipe(
  HttpRouter.mountApp("/api", apiRouter),
  HttpRouter.mountApp("/", serveStaticApp),
)
