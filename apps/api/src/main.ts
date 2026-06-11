import { HttpMiddleware, HttpRouter } from "effect/unstable/http"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
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

  const ServerLive = HttpRouter.serve(app, { middleware }).pipe(
    Layer.provide(
      BunHttpServer.layer({
        port: config.port,
        idleTimeout: 0,
      }),
    ),
  )

  yield* Layer.launch(ServerLive)
})

const BaseServices = Layer.mergeAll(
  Storage.layer,
  ConvexClient.layer,
  ModelProvider.layer,
  TtsService.layer,
).pipe(Layer.provideMerge(AppConfig.layer))

const AllServices = ConversionBackend.layer.pipe(
  Layer.provideMerge(BaseServices),
)

BunRuntime.runMain(
  Effect.provide(program, AllServices),
)
