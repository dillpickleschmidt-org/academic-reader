import { Context, Effect, Layer, Schema } from "effect"

const BackendMode = Schema.Literal("local", "datalab", "modal")
const Provider = Schema.Literal("google", "openrouter", "groq")
const ChatProvider = Schema.Literal("google", "openrouter")

const S3Config = Schema.Struct({
  endpoint: Schema.String,
  publicUrl: Schema.String,
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  bucket: Schema.String,
})

const ConvexConfig = Schema.Struct({
  httpUrl: Schema.String,
  siteUrl: Schema.String,
})

const AiConfig = Schema.Struct({
  googleApiKey: Schema.String,
  openrouterApiKey: Schema.optional(Schema.String),
  groqApiKey: Schema.optional(Schema.String),
  exaApiKey: Schema.String,
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
  backendMode: BackendMode,
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

export class AppConfig extends Context.Tag("AppConfig")<AppConfig, AppConfigShape>() {
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
  return {
    port: Number(e.PORT) || 8787,
    siteUrl: e.SITE_URL,
    backendMode: (e.BACKEND_MODE as AppConfigShape["backendMode"]) ?? "local",
    s3: {
      endpoint: e.S3_ENDPOINT!,
      publicUrl: e.S3_PUBLIC_URL!,
      accessKeyId: e.S3_ACCESS_KEY!,
      secretAccessKey: e.S3_SECRET_KEY!,
      bucket: e.S3_BUCKET!,
    },
    convex: {
      httpUrl: e.CONVEX_HTTP_URL ?? "http://localhost:3211",
      siteUrl: e.CONVEX_SITE_URL ?? "http://localhost:3210",
    },
    ai: {
      googleApiKey: e.GOOGLE_API_KEY!,
      openrouterApiKey: e.OPENROUTER_API_KEY,
      groqApiKey: e.GROQ_API_KEY,
      exaApiKey: e.EXA_API_KEY!,
      chat: {
        provider: (e.CHAT_PROVIDER as "google" | "openrouter") ?? "google",
        model: e.CHAT_MODEL ?? "gemini-3-flash-preview",
      },
      processing: {
        provider: (e.PROCESSING_PROVIDER as AppConfigShape["ai"]["processing"]["provider"]) ?? "groq",
        model: e.PROCESSING_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
      },
      summary: {
        provider: (e.SUMMARY_PROVIDER as AppConfigShape["ai"]["summary"]["provider"]) ?? "google",
        model: e.SUMMARY_MODEL ?? "gemini-3-flash-preview",
      },
    },
    ttsWorkers: {
      qwen3Url: e.QWEN3_TTS_WORKER_URL ?? "http://qwen3-tts:8002",
      kokoroUrl: e.KOKORO_TTS_WORKER_URL ?? "http://kokoro-tts:8001",
    },
    modal: {
      markerUrl: e.MODAL_MARKER_URL,
      lightonocrUrl: e.MODAL_LIGHTONOCR_URL,
      chandraUrl: e.MODAL_CHANDRA_URL,
      qwen3TtsUrl: e.MODAL_QWEN3_TTS_URL,
      kokoroTtsUrl: e.MODAL_KOKORO_TTS_URL,
    },
    datalabApiKey: e.DATALAB_API_KEY,
    otelEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
    tlsCert: e.TLS_CERT,
    tlsKey: e.TLS_KEY,
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

    // Conditional validations
    if (config.backendMode === "datalab" && !config.datalabApiKey) {
      console.error("DATALAB_API_KEY required when BACKEND_MODE=datalab")
      return yield* Effect.die("Invalid configuration")
    }

    const providers = [config.ai.chat.provider, config.ai.processing.provider, config.ai.summary.provider]

    if (providers.includes("openrouter") && !config.ai.openrouterApiKey) {
      console.error("OPENROUTER_API_KEY required when any provider is openrouter")
      return yield* Effect.die("Invalid configuration")
    }

    if ((providers as string[]).includes("groq") && !config.ai.groqApiKey) {
      console.error("GROQ_API_KEY required when any provider is groq")
      return yield* Effect.die("Invalid configuration")
    }

    if (config.backendMode === "modal") {
      if (!config.modal.markerUrl) {
        console.error("MODAL_MARKER_URL required when BACKEND_MODE=modal")
        return yield* Effect.die("Invalid configuration")
      }
      if (!config.modal.qwen3TtsUrl) {
        console.error("MODAL_QWEN3_TTS_URL required when BACKEND_MODE=modal")
        return yield* Effect.die("Invalid configuration")
      }
      if (!config.modal.kokoroTtsUrl) {
        console.error("MODAL_KOKORO_TTS_URL required when BACKEND_MODE=modal")
        return yield* Effect.die("Invalid configuration")
      }
    }
  })
}
