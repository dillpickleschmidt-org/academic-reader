import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { Effect } from "effect"
import { AppConfig } from "../config"

export const runtimeConfigRouter = HttpRouter.add(
  "GET",
  "/api/runtime-config",
  Effect.gen(function* () {
    const config = yield* AppConfig
    const processingModes = config.conversionBackend === "local"
      ? ["fast", "balanced"]
      : config.conversionBackend === "datalab"
        ? ["fast", "balanced", "aggressive"]
        : [
            "fast",
            ...(config.modal.lightonocrUrl ? ["balanced"] : []),
            ...(config.modal.chandraUrl ? ["aggressive"] : []),
          ]

    return HttpServerResponse.jsonUnsafe({
      convexUrl: config.convex.publicApiUrl,
      conversionBackend: config.conversionBackend,
      ttsEnabled: config.ttsBackend !== "none",
      webSearchEnabled: !!config.ai.exaApiKey,
      processingModes,
    })
  }),
)
