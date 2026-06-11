import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { Effect } from "effect"
import { AppConfig } from "../config"

export const healthRouter = HttpRouter.add(
  "GET",
  "/api/health",
  Effect.gen(function* () {
    const config = yield* AppConfig
    return HttpServerResponse.jsonUnsafe({
      status: "ok",
      conversionBackend: config.conversionBackend,
      ttsBackend: config.ttsBackend,
    })
  }),
)
