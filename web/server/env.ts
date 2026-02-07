import { z } from "zod"

const backendModeSchema = z.enum(["local", "datalab", "modal"]).default("local")

const baseSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8787),
  TLS_CERT: z.string().optional(),
  TLS_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  SITE_URL: z.url().optional(),

  // Storage (required)
  S3_ENDPOINT: z.url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_PUBLIC_URL: z.url(), // Required for serving images from converted PDFs

  // Convex
  CONVEX_HTTP_URL: z.url().default("http://localhost:3211"),
  CONVEX_SITE_URL: z.url().default("http://localhost:3210"),

  // AI - shared keys
  GOOGLE_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().min(1),

  // AI - chat model (chatbot, summary, title generation)
  CHAT_PROVIDER: z.enum(["google", "openrouter"]).default("google"),
  CHAT_MODEL: z.string().default("gemini-3-flash-preview"),

  // AI - processing model (TOC extraction, TTS block filter)
  PROCESSING_PROVIDER: z.enum(["google", "openrouter"]).default("google"),
  PROCESSING_MODEL: z.string().default("gemini-3-flash-preview"),

  // Backend mode
  BACKEND_MODE: backendModeSchema,

  // Local TTS worker URL (Docker)
  QWEN3_TTS_WORKER_URL: z.url().default("http://qwen3-tts:8002"),

  // DataLab backend
  DATALAB_API_KEY: z.string().optional(),

  // Modal backend - conversion workers
  MODAL_MARKER_URL: z.url().optional(),
  MODAL_LIGHTONOCR_URL: z.url().optional(),
  MODAL_CHANDRA_URL: z.url().optional(),

  // Modal backend - TTS worker
  MODAL_QWEN3_TTS_URL: z.url().optional(),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
})

// Refinements for conditional requirements
const envSchema = baseSchema.superRefine((data, ctx) => {
  // DataLab mode requires DataLab credentials
  if (data.BACKEND_MODE === "datalab") {
    if (!data.DATALAB_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DATALAB_API_KEY required when BACKEND_MODE=datalab",
        path: ["DATALAB_API_KEY"],
      })
    }
  }

  // OpenRouter requires an API key
  if (
    (data.CHAT_PROVIDER === "openrouter" ||
      data.PROCESSING_PROVIDER === "openrouter") &&
    !data.OPENROUTER_API_KEY
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "OPENROUTER_API_KEY required when any provider is openrouter",
      path: ["OPENROUTER_API_KEY"],
    })
  }

  // Modal mode requires at least the marker URL
  if (data.BACKEND_MODE === "modal") {
    if (!data.MODAL_MARKER_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MODAL_MARKER_URL required when BACKEND_MODE=modal",
        path: ["MODAL_MARKER_URL"],
      })
    }
    // TTS on Modal requires qwen3 endpoint
    if (!data.MODAL_QWEN3_TTS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MODAL_QWEN3_TTS_URL required when BACKEND_MODE=modal",
        path: ["MODAL_QWEN3_TTS_URL"],
      })
    }
  }
})

export type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error("Environment validation failed:")
    for (const error of result.error.issues) {
      console.error(`  ${error.path.join(".")}: ${error.message}`)
    }
    process.exit(1)
  }
  return result.data
}

export const env = parseEnv()
