/**
 * Self-hosted API entry point.
 * Serves both API routes (/api/*) and frontend static files.
 */
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "hono/bun"
import { proxy } from "hono/proxy"
import { upload } from "./routes/upload"
import { convert } from "./routes/convert"
import { jobs } from "./routes/jobs"
import { download } from "./routes/download"
import { documentEmbeddings } from "./routes/document-embeddings"
import { savedDocuments } from "./routes/saved-documents"
import { chat } from "./routes/chat"
import { tts } from "./routes/tts"
import type { Storage } from "./storage/types"
import { createStorage } from "./storage/factory"
import { wideEvent } from "./middleware/wide-event-middleware"
import { env } from "./env"

type Variables = {
  storage: Storage
}

const app = new Hono<{ Variables: Variables }>()

// Create unified storage (S3 in prod, Disk in dev)
const storage = createStorage()

// Wide event middleware for API routes only (not static files)
app.use("/api/*", wideEvent)

// Middleware to inject storage
app.use("*", async (c, next) => {
  c.set("storage", storage)
  await next()
})

// CORS for API routes only
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      // Require SITE_URL to be configured for cross-origin requests
      if (!env.SITE_URL) return null
      return origin === env.SITE_URL ? origin : null
    },
    credentials: true,
  }),
)

// ─────────────────────────────────────────────────────────────
// Auth Proxy (must be before /api mount to match first)
// ─────────────────────────────────────────────────────────────
const authProxy = async (c: Context) => {
  const url = new URL(c.req.url)
  const targetUrl = `${env.CONVEX_HTTP_URL}${url.pathname}${url.search}`
  const targetHost = new URL(env.CONVEX_HTTP_URL).host

  try {
    return await proxy(targetUrl, {
      ...c.req,
      headers: {
        ...c.req.header(),
        host: targetHost,
      },
      redirect: "manual", // Don't follow redirects, pass them to browser
    })
  } catch (error) {
    const event = c.get("event")
    const message = error instanceof Error ? error.message : "Unknown error"
    event.error = { category: "auth", message, code: "AUTH_PROXY_ERROR" }
    return c.json({ error: "Auth service unavailable" }, 502)
  }
}
app.all("/api/auth/*", authProxy)

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────
const api = new Hono<{ Variables: Variables }>()
api.route("/", upload)
api.route("/", convert)
api.route("/jobs", jobs)
api.route("/", download)
api.route("/", documentEmbeddings)
api.route("/", savedDocuments)
api.route("/", chat)
api.route("/", tts)
api.get("/health", (c) =>
  c.json({ status: "ok", mode: env.BACKEND_MODE }),
)
app.route("/api", api)

// ─────────────────────────────────────────────────────────────
// Static Files (SPA)
// ─────────────────────────────────────────────────────────────
app.use("/*", serveStatic({ root: "./dist" }))
app.use("/*", serveStatic({ path: "./dist/index.html" })) // SPA fallback

// Start server
console.log(`Starting server on port ${env.PORT}`)
console.log(`Backend: ${env.BACKEND_MODE}`)
if (env.TLS_CERT && env.TLS_KEY) console.log("TLS: enabled")

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 0, // Disable timeout for SSE streams
  ...(env.TLS_CERT && env.TLS_KEY
    ? {
        tls: {
          cert: Bun.file(env.TLS_CERT),
          key: Bun.file(env.TLS_KEY),
        },
      }
    : {}),
}
