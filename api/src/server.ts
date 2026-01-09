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
import { chat } from "./routes/chat"
import {
  createStorage,
  MemoryTempStorage,
  type S3Storage,
  type TempStorage,
} from "./storage"
import { wideEvent } from "./middleware/wide-event"

type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

const app = new Hono<{ Variables: Variables }>()

// Create storage instances (singleton for the process lifetime)
const tempStorage = new MemoryTempStorage()
const storage = createStorage({
  BACKEND_MODE: (process.env.BACKEND_MODE as "local" | "runpod" | "datalab") || "datalab",
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
})

// Wide event middleware for API routes only (not static files)
app.use("/api/*", wideEvent)

// Middleware to inject storage
app.use("*", async (c, next) => {
  c.set("storage", storage)
  c.set("tempStorage", tempStorage)
  await next()
})

// CORS for API routes only
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const siteUrl = process.env.SITE_URL
      if (!siteUrl) return origin
      // Only allow requests from the configured site URL
      return origin === siteUrl ? origin : null
    },
    credentials: true,
  }),
)

// ─────────────────────────────────────────────────────────────
// Auth Proxy (must be before /api mount to match first)
// ─────────────────────────────────────────────────────────────
const authProxy = async (c: Context) => {
  const url = new URL(c.req.url)
  const convexHttpUrl = process.env.CONVEX_HTTP_URL || "http://localhost:3211"
  const targetUrl = `${convexHttpUrl}${url.pathname}${url.search}`
  const targetHost = new URL(convexHttpUrl).host

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
api.route("/", jobs)
api.route("/", download)
api.route("/", chat)
api.get("/health", (c) => c.json({ status: "ok", mode: process.env.BACKEND_MODE }))
app.route("/api", api)

// ─────────────────────────────────────────────────────────────
// Static Files (SPA)
// ─────────────────────────────────────────────────────────────
app.use("/*", serveStatic({ root: "./frontend/dist" }))
app.use("/*", serveStatic({ path: "./frontend/dist/index.html" })) // SPA fallback

// Start server
const port = parseInt(process.env.PORT || "8787", 10)
const tlsCert = process.env.TLS_CERT
const tlsKey = process.env.TLS_KEY

console.log(`Starting server on port ${port}`)
console.log(`Backend: ${process.env.BACKEND_MODE || "datalab"}`)
if (tlsCert && tlsKey) console.log("TLS: enabled")

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 0, // Disable timeout for SSE streams
  ...(tlsCert && tlsKey
    ? {
        tls: {
          cert: Bun.file(tlsCert),
          key: Bun.file(tlsKey),
        },
      }
    : {}),
}
