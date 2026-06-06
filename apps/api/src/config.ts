import { Context, Effect, Layer, Schema } from "effect"

const ConversionBackend = Schema.Literal("local", "datalab", "modal")
const TtsBackend = Schema.Literal("local", "modal", "none")
const Provider = Schema.Literal("google", "openrouter", "groq")
const ChatProvider = Schema.Literal("google", "openrouter")

const S3Config = Schema.Struct({
  apiEndpoint: Schema.String,
  presignedUrlEndpoint: Schema.String,
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  bucket: Schema.String,
})

const ConvexConfig = Schema.Struct({
  apiUrl: Schema.String,
  httpActionsUrl: Schema.String,
  publicApiUrl: Schema.String,
  apiToConvexServiceSecret: Schema.String,
})

const AiConfig = Schema.Struct({
  googleApiKey: Schema.String,
  openrouterApiKey: Schema.optional(Schema.String),
  groqApiKey: Schema.optional(Schema.String),
  exaApiKey: Schema.optional(Schema.String),
  chat: Schema.Struct({
    provider: ChatProvider,
    model: Schema.String,
  }),
  processing: Schema.Struct({
    provider: Provider,
    model: Schema.String,
  }),
  summary: Schema.Struct({
    provider: Provider,
    model: Schema.String,
  }),
})

const TtsWorkersConfig = Schema.Struct({
  qwen3Url: Schema.String,
  kokoroUrl: Schema.String,
})

const ModalConfig = Schema.Struct({
  markerUrl: Schema.optional(Schema.String),
  lightonocrUrl: Schema.optional(Schema.String),
  chandraUrl: Schema.optional(Schema.String),
  qwen3TtsUrl: Schema.optional(Schema.String),
  kokoroTtsUrl: Schema.optional(Schema.String),
})

const AppConfigSchema = Schema.Struct({
  port: Schema.Number,
  siteUrl: Schema.optional(Schema.String),
  conversionBackend: ConversionBackend,
  ttsBackend: TtsBackend,
  s3: S3Config,
  convex: ConvexConfig,
  ai: AiConfig,
  ttsWorkers: TtsWorkersConfig,
  modal: ModalConfig,
  datalabApiKey: Schema.optional(Schema.String),
  otelEndpoint: Schema.optional(Schema.String),
  tlsCert: Schema.optional(Schema.String),
  tlsKey: Schema.optional(Schema.String),
})

export type AppConfigShape = typeof AppConfigSchema.Type

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  static Live = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const config = readEnv()
      yield* validate(config)
      return config
    }),
  )
}

function readEnv(): AppConfigShape {
  const e = process.env
  const conversionBackend = (optionalEnv("CONVERSION_BACKEND") ??
    "local") as AppConfigShape["conversionBackend"]
  const ttsBackend = (optionalEnv("TTS_BACKEND") ??
    (conversionBackend === "local" ? "local" : "none")) as AppConfigShape["ttsBackend"]

  return {
    port: Number(e.PORT) || 8787,
    siteUrl: optionalEnv("SITE_URL"),
    conversionBackend,
    ttsBackend,
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
      chat: {
        provider: (optionalEnv("CHAT_PROVIDER") ?? "google") as
          | "google"
          | "openrouter",
        model: optionalEnv("CHAT_MODEL") ?? "gemini-3-flash-preview",
      },
      processing: {
        provider:
          (optionalEnv("PROCESSING_PROVIDER") as
            | AppConfigShape["ai"]["processing"]["provider"]
            | undefined) ?? "google",
        model: optionalEnv("PROCESSING_MODEL") ?? "gemini-3-flash-preview",
      },
      summary: {
        provider:
          (optionalEnv("SUMMARY_PROVIDER") as
            | AppConfigShape["ai"]["summary"]["provider"]
            | undefined) ?? "google",
        model: optionalEnv("SUMMARY_MODEL") ?? "gemini-3-flash-preview",
      },
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
    tlsCert: optionalEnv("TLS_CERT"),
    tlsKey: optionalEnv("TLS_KEY"),
  }
}

function validate(config: AppConfigShape) {
  return Effect.gen(function* () {
    const decode = Schema.decodeUnknown(AppConfigSchema)
    const result = yield* Effect.either(decode(config))

    if (result._tag === "Left") {
      console.error("Environment validation failed:")
      console.error(result.left.message)
      return yield* Effect.die("Invalid configuration")
    }

    if (!config.siteUrl) {
      console.error("SITE_URL is required")
      return yield* Effect.die("Invalid configuration")
    }

    for (const [key, value] of [
      ["S3_API_ENDPOINT", config.s3.apiEndpoint],
      ["S3_PRESIGNED_URL_ENDPOINT", config.s3.presignedUrlEndpoint],
      ["S3_ACCESS_KEY", config.s3.accessKeyId],
      ["S3_SECRET_KEY", config.s3.secretAccessKey],
      ["S3_BUCKET", config.s3.bucket],
      ["API_TO_CONVEX_SERVICE_SECRET", config.convex.apiToConvexServiceSecret],
    ] as const) {
      if (!value) {
        console.error(`${key} is required`)
        return yield* Effect.die("Invalid configuration")
      }
    }

    if (!config.ai.googleApiKey) {
      console.error(
        "GOOGLE_API_KEY is required for default chat, summaries, and document embeddings",
      )
      return yield* Effect.die("Invalid configuration")
    }

    if (config.conversionBackend === "datalab" && !config.datalabApiKey) {
      console.error("DATALAB_API_KEY required when CONVERSION_BACKEND=datalab")
      return yield* Effect.die("Invalid configuration")
    }

    const providers = [
      config.ai.chat.provider,
      config.ai.processing.provider,
      config.ai.summary.provider,
    ]

    if (providers.includes("openrouter") && !config.ai.openrouterApiKey) {
      console.error(
        "OPENROUTER_API_KEY required when any provider is openrouter",
      )
      return yield* Effect.die("Invalid configuration")
    }

    if ((providers as string[]).includes("groq") && !config.ai.groqApiKey) {
      console.error("GROQ_API_KEY required when any provider is groq")
      return yield* Effect.die("Invalid configuration")
    }

    if (config.conversionBackend === "modal") {
      if (!config.modal.markerUrl) {
        console.error("MODAL_MARKER_URL required when CONVERSION_BACKEND=modal")
        return yield* Effect.die("Invalid configuration")
      }
    }

    if (config.ttsBackend === "modal") {
      if (!config.modal.qwen3TtsUrl) {
        console.error("MODAL_QWEN3_TTS_URL required when TTS_BACKEND=modal")
        return yield* Effect.die("Invalid configuration")
      }
      if (!config.modal.kokoroTtsUrl) {
        console.error("MODAL_KOKORO_TTS_URL required when TTS_BACKEND=modal")
        return yield* Effect.die("Invalid configuration")
      }
    }
  })
}

function env(name: string, fallback = ""): string {
  return optionalEnv(name) ?? fallback
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}
