import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { Effect, Layer } from "effect"
import { resolve, join } from "path"
import { statSync } from "fs"
import { healthRouter } from "./routes/health"
import { uploadRouter } from "./routes/upload"
import { chatRouter } from "./routes/chat"
import { documentsRouter } from "./routes/documents"
import { ttsRouter } from "./routes/tts"
import { runtimeConfigRouter } from "./routes/runtime-config"
import { assetsRouter } from "./routes/assets"

const STATIC_DIR = resolve(import.meta.dirname, "../../web/dist")

const serveStaticApp = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const url = new URL(request.url, "http://localhost")
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return HttpServerResponse.jsonUnsafe(
      { error: "Not Found" },
      { status: 404 },
    )
  }

  const filePath = join(STATIC_DIR, pathname)
  if (!filePath.startsWith(STATIC_DIR)) {
    return HttpServerResponse.text("Forbidden", { status: 403 })
  }

  let isFile = false
  try {
    isFile = statSync(filePath).isFile()
  } catch {}

  const target = isFile ? filePath : join(STATIC_DIR, "index.html")
  return yield* HttpServerResponse.file(target).pipe(
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("Not Found", { status: 404 })),
    ),
  )
})

export const app = Layer.mergeAll(
  healthRouter,
  uploadRouter,
  chatRouter,
  documentsRouter,
  ttsRouter,
  runtimeConfigRouter,
  assetsRouter,
  HttpRouter.add("GET", "*", serveStaticApp),
)
