import { HttpMiddleware, HttpServer } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { BunRuntime } from "@effect/platform-bun"
import { AppConfig } from "./config"
import { Storage } from "./services/storage"
import { ConvexClient } from "./services/convex-client"
import { ConversionBackend } from "./services/backends/conversion"
import { ModelProvider } from "./services/model-provider"
import { TtsService } from "./services/backends/tts"
import { JobFileMap } from "./services/job-file-map"
import { app } from "./router"
import { wideEventMiddleware } from "./middleware/wide-event"

const program = Effect.gen(function* () {
  const config = yield* AppConfig

  console.log(`Starting server on port ${config.port}`)
  console.log(`Backend: ${config.backendMode}`)
  if (config.tlsCert && config.tlsKey) console.log("TLS: enabled")

  const middleware = HttpMiddleware.make((httpApp) =>
    wideEventMiddleware(
      config.backendMode,
      config.siteUrl,
      config.otelEndpoint,
    )(
      HttpMiddleware.cors({
        allowedOrigins: config.siteUrl ? [config.siteUrl] : [],
        credentials: true,
      })(HttpMiddleware.logger(httpApp)),
    ),
  )

  const ServerLive = (app as any).pipe(
    HttpServer.serve(middleware),
    Layer.provide(
      BunHttpServer.layer({
        port: config.port,
        idleTimeout: 0,
        ...(config.tlsCert && config.tlsKey
          ? {
              tls: {
                cert: Bun.file(config.tlsCert),
                key: Bun.file(config.tlsKey),
              },
            }
          : {}),
      }),
    ),
  ) as Layer.Layer<never, unknown, never>

  yield* Layer.launch(ServerLive)
})

const MainLive = Layer.mergeAll(
  AppConfig.Live,
  Storage.Live,
  ConvexClient.Live,
  ModelProvider.Live,
  TtsService.Live,
  JobFileMap.Live,
).pipe(Layer.provideMerge(AppConfig.Live))

const ConversionLive = ConversionBackend.Live.pipe(
  Layer.provide(AppConfig.Live),
  Layer.provide(Storage.Live.pipe(Layer.provide(AppConfig.Live))),
)

const AllServices = Layer.mergeAll(MainLive, ConversionLive)

BunRuntime.runMain(
  Effect.provide(program, AllServices) as Effect.Effect<void, unknown, never>,
)
