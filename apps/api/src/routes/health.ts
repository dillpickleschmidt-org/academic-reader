import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { AppConfig } from "../config"

export const healthRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/",
    Effect.gen(function* () {
      const config = yield* AppConfig
      return HttpServerResponse.unsafeJson({ status: "ok", mode: config.backendMode })
    }),
  ),
)
