import { z } from "zod"

const backendModeSchema = z.enum(["local", "runpod", "datalab"]).default("local")

const baseSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8787),
  TLS_CERT: z.string().optional(),
  TLS_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  SITE_URL: z.string().url().optional(),

  // Storage (required)
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_PUBLIC_URL: z.string().url(), // Required for serving images from converted PDFs

  // Convex
  CONVEX_HTTP_URL: z.string().url().default("http://localhost:3211"),
  CONVEX_SITE_URL: z.string().url().default("http://localhost:3210"),

  // AI Provider
  AI_PROVIDER: z.enum(["google", "openrouter"]).default("google"),
  GOOGLE_API_KEY: z.string().min(1),
  GOOGLE_CHAT_MODEL: z.string().default("gemini-3-flash-preview"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("moonshotai/kimi-k2"),

  // Backend mode
  BACKEND_MODE: backendModeSchema,

  // TTS Engine: Chatterbox
  CHATTERBOX_TTS_WORKER_URL: z.string().url().default("http://chatterbox-tts:8001"),
  RUNPOD_CHATTERBOX_TTS_ENDPOINT_ID: z.string().optional(),

  // TTS Engine: Qwen3
  QWEN3_TTS_WORKER_URL: z.string().url().default("http://qwen3-tts:8002"),
  RUNPOD_QWEN3_TTS_ENDPOINT_ID: z.string().optional(),

  // RunPod backend
  RUNPOD_API_KEY: z.string().optional(),
  RUNPOD_MARKER_ENDPOINT_ID: z.string().optional(),
  RUNPOD_CHANDRA_ENDPOINT_ID: z.string().optional(),

  // DataLab backend
  DATALAB_API_KEY: z.string().optional(),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
})

// Refinements for conditional requirements
const envSchema = baseSchema.superRefine((data, ctx) => {
  // RunPod mode requires RunPod credentials
  if (data.BACKEND_MODE === "runpod") {
    if (!data.RUNPOD_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RUNPOD_API_KEY required when BACKEND_MODE=runpod",
        path: ["RUNPOD_API_KEY"],
      })
    }
    if (!data.RUNPOD_MARKER_ENDPOINT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RUNPOD_MARKER_ENDPOINT_ID required when BACKEND_MODE=runpod",
        path: ["RUNPOD_MARKER_ENDPOINT_ID"],
      })
    }
  }

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

  // TTS on cloud backends requires at least one TTS endpoint
  if (
    data.BACKEND_MODE !== "local" &&
    !data.RUNPOD_CHATTERBOX_TTS_ENDPOINT_ID &&
    !data.RUNPOD_QWEN3_TTS_ENDPOINT_ID
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one TTS endpoint required for cloud backends",
      path: ["RUNPOD_CHATTERBOX_TTS_ENDPOINT_ID"],
    })
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
