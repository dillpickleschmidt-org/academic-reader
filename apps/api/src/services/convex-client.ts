import { Context, Effect, Layer } from "effect"
import { HttpServerRequest } from "@effect/platform"
import { ConvexHttpClient } from "convex/browser"
import { getToken } from "@convex-dev/better-auth/utils"
import { AuthError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"

export interface ConvexClientService {
  fromRequest(): Effect.Effect<
    ConvexHttpClient,
    AuthError,
    HttpServerRequest.HttpServerRequest
  >
}

export class ConvexClient extends Context.Tag("ConvexClient")<
  ConvexClient,
  ConvexClientService
>() {
  static Live = Layer.effect(
    ConvexClient,
    Effect.gen(function* () {
      const config = yield* AppConfig

      return {
        fromRequest: () =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const headers = new Headers()
            const cookies = request.cookies
            const cookieStr = Object.entries(cookies)
              .map(([k, v]) => `${k}=${v}`)
              .join("; ")
            if (cookieStr) headers.set("Cookie", cookieStr)

            const result = yield* Effect.tryPromise({
              try: async () => {
                const { token } = await getToken(config.convex.httpUrl, headers)
                if (!token) return null

                const client = new ConvexHttpClient(config.convex.siteUrl)
                client.setAuth(token)
                return client
              },
              catch: (e) =>
                new AuthError({
                  message: `Convex auth failed: ${e instanceof Error ? e.message : String(e)}`,
                  code: "CONVEX_AUTH_ERROR",
                }),
            })

            if (!result) {
              return yield* new AuthError({
                message: "No valid session token",
                code: "NO_SESSION",
              })
            }

            return result
          }),
      }
    }),
  )
}
