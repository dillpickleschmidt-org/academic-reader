/**
 * Self-hosted API entry point.
 * Runs on Bun for self-hosted deployments (Datalab, Runpod with MinIO).
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
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

// Access environment variables via Bun's API
const env = Bun.env

// Extended context with storage adapters
type Variables = {
  storage: S3Storage | null
  tempStorage: TempStorage | null
}

// Create app with typed bindings
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
  // Inject environment variables as bindings
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

  // Inject storage adapters
  c.set("storage", storage)
  c.set("tempStorage", tempStorage)

  await next()
})

// CORS - use SITE_URL as the allowed origin
app.use(
  "*",
  cors({
    origin: (origin) => {
      const siteUrl = env.SITE_URL
      if (!siteUrl) return origin // Allow all if not set
      return origin === siteUrl ? origin : siteUrl
    },
  }),
)

// Mount routes
app.route("/", upload)
app.route("/", convert)
app.route("/", jobs)
app.route("/", download)
app.route("/", chat)

// Health check
app.get("/health", (c) => c.json({ status: "ok", mode: "self-hosted" }))

// Start server
const port = parseInt(env.PORT || "8787", 10)
console.log(`Starting self-hosted API on port ${port}`)
console.log(`Backend: ${env.BACKEND_MODE || "datalab"}`)

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 0, // Disable timeout for SSE streams
}
