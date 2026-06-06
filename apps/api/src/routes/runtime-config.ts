import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { AppConfig } from "../config"

export const runtimeConfigRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/",
    Effect.gen(function* () {
      const config = yield* AppConfig
      return HttpServerResponse.unsafeJson({
        convexUrl: config.convex.publicApiUrl,
        conversionBackend: config.conversionBackend,
        ttsEnabled: config.ttsBackend !== "none",
        webSearchEnabled: !!config.ai.exaApiKey,
        processingModes: processingModes(config),
      })
    }),
  ),
)

function processingModes(config: {
  conversionBackend: "local" | "datalab" | "modal"
  modal: { lightonocrUrl?: string; chandraUrl?: string }
}) {
  if (config.conversionBackend === "local") return ["fast", "balanced"]
  if (config.conversionBackend === "datalab") {
    return ["fast", "balanced", "aggressive"]
  }

  return [
    "fast",
    ...(config.modal.lightonocrUrl ? ["balanced"] : []),
    ...(config.modal.chandraUrl ? ["aggressive"] : []),
  ]
}
