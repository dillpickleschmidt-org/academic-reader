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
import type { Env } from "./types"

const env = Bun.env

type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// Create storage instances (singleton for the process lifetime)
const tempStorage = new MemoryTempStorage()
const storage = createStorage({
  BACKEND_MODE: env.BACKEND_MODE || "datalab",
  S3_ENDPOINT: env.S3_ENDPOINT,
  S3_ACCESS_KEY: env.S3_ACCESS_KEY,
  S3_SECRET_KEY: env.S3_SECRET_KEY,
  S3_BUCKET: env.S3_BUCKET,
})

// Middleware to inject environment and storage
app.use("*", async (c, next) => {
  c.env = {
    BACKEND_MODE: (env.BACKEND_MODE || "datalab") as Env["BACKEND_MODE"],
    LOCAL_WORKER_URL: env.LOCAL_WORKER_URL,
    RUNPOD_ENDPOINT_ID: env.RUNPOD_ENDPOINT_ID,
    RUNPOD_API_KEY: env.RUNPOD_API_KEY,
    DATALAB_API_KEY: env.DATALAB_API_KEY,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_ACCESS_KEY: env.S3_ACCESS_KEY,
    S3_SECRET_KEY: env.S3_SECRET_KEY,
    S3_BUCKET: env.S3_BUCKET,
    SITE_URL: env.SITE_URL,
  }
  c.set("storage", storage)
  c.set("tempStorage", tempStorage)
  await next()
})

// CORS for API routes only
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const siteUrl = env.SITE_URL
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
  const targetUrl = `http://convex-backend:3211${url.pathname}${url.search}`

  try {
    return await proxy(targetUrl, {
      ...c.req,
      headers: {
        ...c.req.header(),
        host: "convex-backend:3211",
      },
      redirect: "manual", // Don't follow redirects, pass them to browser
    })
  } catch (error) {
    console.error("Auth proxy error:", error)
    return c.json({ error: "Auth service unavailable" }, 502)
  }
}
app.all("/api/auth/*", authProxy)

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: Variables }>()
api.route("/", upload)
api.route("/", convert)
api.route("/", jobs)
api.route("/", download)
api.route("/", chat)
api.get("/health", (c) => c.json({ status: "ok", mode: env.BACKEND_MODE }))
app.route("/api", api)

// ─────────────────────────────────────────────────────────────
// Static Files (SPA)
// ─────────────────────────────────────────────────────────────
app.use("/*", serveStatic({ root: "./frontend/dist" }))
app.use("/*", serveStatic({ path: "./frontend/dist/index.html" })) // SPA fallback

// Start server
const port = parseInt(env.PORT || "8787", 10)
const tlsCert = env.TLS_CERT
const tlsKey = env.TLS_KEY

console.log(`Starting server on port ${port}`)
console.log(`Backend: ${env.BACKEND_MODE || "datalab"}`)
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
