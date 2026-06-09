import { Context, Effect, Layer } from "effect"

type ConversionBackend = "local" | "datalab" | "modal"
type TtsBackend = "local" | "modal" | "none"
type AiProvider = "google" | "openrouter" | "groq"

export interface AppConfigShape {
  port: number
  siteUrl: string
  environment: string
  conversionBackend: ConversionBackend
  ttsBackend: TtsBackend
  s3: {
    apiEndpoint: string
    presignedUrlEndpoint: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
  }
  convex: {
    apiUrl: string
    httpActionsUrl: string
    publicApiUrl: string
    apiToConvexServiceSecret: string
  }
  ai: {
    googleApiKey: string
    openrouterApiKey?: string
    groqApiKey?: string
    exaApiKey?: string
    provider: AiProvider
    model: string
  }
  ttsWorkers: {
    qwen3Url: string
    kokoroUrl: string
  }
  modal: {
    markerUrl?: string
    lightonocrUrl?: string
    chandraUrl?: string
    qwen3TtsUrl?: string
    kokoroTtsUrl?: string
  }
  datalabApiKey?: string
  otelEndpoint?: string
}

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  static Live = Layer.effect(
    AppConfig,
    Effect.sync(() => {
      const config = readEnv()
      validate(config)
      return config
    }),
  )
}

function readEnv(): AppConfigShape {
  const e = process.env
  const siteUrl = env("SITE_URL")
  const conversionBackend = literalEnv(
    "CONVERSION_BACKEND",
    ["local", "datalab", "modal"] as const,
    "local",
  )

  return {
    port: Number(e.PORT) || 8787,
    siteUrl,
    environment:
      optionalEnv("APP_ENV") ??
      optionalEnv("NODE_ENV") ??
      (siteUrl.includes("localhost") ? "dev" : "prod"),
    conversionBackend,
    ttsBackend: literalEnv(
      "TTS_BACKEND",
      ["local", "modal", "none"] as const,
      conversionBackend === "local" ? "local" : "none",
    ),
    s3: {
      apiEndpoint: env("S3_API_ENDPOINT"),
      presignedUrlEndpoint: env("S3_PRESIGNED_URL_ENDPOINT"),
      accessKeyId: env("S3_ACCESS_KEY"),
      secretAccessKey: env("S3_SECRET_KEY"),
      bucket: env("S3_BUCKET"),
    },
    convex: {
      apiUrl: env("CONVEX_API_URL", "http://localhost:3210"),
      httpActionsUrl: env("CONVEX_HTTP_ACTIONS_URL", "http://localhost:3211"),
      publicApiUrl: env("PUBLIC_CONVEX_API_URL", "http://localhost:3210"),
      apiToConvexServiceSecret: env("API_TO_CONVEX_SERVICE_SECRET"),
    },
    ai: {
      googleApiKey: env("GOOGLE_API_KEY"),
      openrouterApiKey: optionalEnv("OPENROUTER_API_KEY"),
      groqApiKey: optionalEnv("GROQ_API_KEY"),
      exaApiKey: optionalEnv("EXA_API_KEY"),
      provider: literalEnv(
        "AI_PROVIDER",
        ["google", "openrouter", "groq"] as const,
        "groq",
      ),
      model: optionalEnv("AI_MODEL") ?? "openai/gpt-oss-120b",
    },
    ttsWorkers: {
      qwen3Url: env("QWEN3_TTS_WORKER_URL", "http://qwen3-tts:8002"),
      kokoroUrl: env("KOKORO_TTS_WORKER_URL", "http://kokoro-tts:8001"),
    },
    modal: {
      markerUrl: optionalEnv("MODAL_MARKER_URL"),
      lightonocrUrl: optionalEnv("MODAL_LIGHTONOCR_URL"),
      chandraUrl: optionalEnv("MODAL_CHANDRA_URL"),
      qwen3TtsUrl: optionalEnv("MODAL_QWEN3_TTS_URL"),
      kokoroTtsUrl: optionalEnv("MODAL_KOKORO_TTS_URL"),
    },
    datalabApiKey: optionalEnv("DATALAB_API_KEY"),
    otelEndpoint: optionalEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  }
}

function validate(config: AppConfigShape) {
  for (const [key, value] of [
    ["SITE_URL", config.siteUrl],
    ["S3_API_ENDPOINT", config.s3.apiEndpoint],
    ["S3_PRESIGNED_URL_ENDPOINT", config.s3.presignedUrlEndpoint],
    ["S3_ACCESS_KEY", config.s3.accessKeyId],
    ["S3_SECRET_KEY", config.s3.secretAccessKey],
    ["S3_BUCKET", config.s3.bucket],
    ["API_TO_CONVEX_SERVICE_SECRET", config.convex.apiToConvexServiceSecret],
  ] as const) {
    if (!value) invalidConfig(`${key} is required`)
  }

  if (!config.ai.googleApiKey) {
    invalidConfig("GOOGLE_API_KEY is required for document embeddings")
  }
  if (config.conversionBackend === "datalab" && !config.datalabApiKey) {
    invalidConfig("DATALAB_API_KEY required when CONVERSION_BACKEND=datalab")
  }
  if (config.ai.provider === "openrouter" && !config.ai.openrouterApiKey) {
    invalidConfig("OPENROUTER_API_KEY required when AI_PROVIDER=openrouter")
  }
  if (config.ai.provider === "groq" && !config.ai.groqApiKey) {
    invalidConfig("GROQ_API_KEY required when AI_PROVIDER=groq")
  }
  if (config.conversionBackend === "modal" && !config.modal.markerUrl) {
    invalidConfig("MODAL_MARKER_URL required when CONVERSION_BACKEND=modal")
  }
  if (config.ttsBackend === "modal") {
    if (!config.modal.qwen3TtsUrl) {
      invalidConfig("MODAL_QWEN3_TTS_URL required when TTS_BACKEND=modal")
    }
    if (!config.modal.kokoroTtsUrl) {
      invalidConfig("MODAL_KOKORO_TTS_URL required when TTS_BACKEND=modal")
    }
  }
}

function literalEnv<T extends string>(
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = optionalEnv(name)
  if (!value) return fallback
  if ((values as readonly string[]).includes(value)) return value as T
  return invalidConfig(`${name} must be one of: ${values.join(", ")}`)
}

function invalidConfig(message: string): never {
  writeConfigError(message)
  throw new Error("Invalid configuration")
}

function writeConfigError(message: string) {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "academic-reader-api",
      eventName: "config_validation_failed",
      severity: "ERROR",
      errorCategory: "configuration",
      errorMessage: message,
    })}\n`,
  )
}

function env(name: string, fallback = ""): string {
  return optionalEnv(name) ?? fallback
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}
