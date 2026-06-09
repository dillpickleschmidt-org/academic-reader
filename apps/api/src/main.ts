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
import { app } from "./router"
import {
  emitLifecycleEvent,
  wideEventMiddleware,
} from "./middleware/wide-event"

const program = Effect.gen(function* () {
  const config = yield* AppConfig

  emitLifecycleEvent(
    {
      eventName: "server_start",
      path: "/lifecycle/server-start",
      status: 200,
      environment: config.environment,
      conversionBackend: config.conversionBackend,
      ttsBackend: config.ttsBackend,
      port: config.port,
    },
    config.otelEndpoint,
  )

  const middleware = HttpMiddleware.make((httpApp) =>
    wideEventMiddleware(
      {
        environment: config.environment,
        conversionBackend: config.conversionBackend,
        ttsBackend: config.ttsBackend,
      },
      config.otelEndpoint,
    )(
      HttpMiddleware.cors({
        allowedOrigins: [config.siteUrl],
        credentials: true,
      })(httpApp),
    ),
  )

  const ServerLive = app.pipe(
    HttpServer.serve(middleware),
    Layer.provide(
      BunHttpServer.layer({
        port: config.port,
        idleTimeout: 0,
      }),
    ),
  )

  yield* Layer.launch(ServerLive)
})

const MainLive = Layer.mergeAll(
  AppConfig.Live,
  Storage.Live,
  ConvexClient.Live,
  ModelProvider.Live,
  TtsService.Live,
).pipe(Layer.provideMerge(AppConfig.Live))

const ConversionLive = ConversionBackend.Live.pipe(
  Layer.provide(AppConfig.Live),
  Layer.provide(Storage.Live.pipe(Layer.provide(AppConfig.Live))),
)

const AllServices = Layer.mergeAll(MainLive, ConversionLive)

BunRuntime.runMain(
  Effect.provide(program, AllServices),
)
