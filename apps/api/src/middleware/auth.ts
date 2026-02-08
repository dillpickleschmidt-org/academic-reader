import { Effect } from "effect"
import { HttpServerRequest } from "@effect/platform"
import { AuthError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"
import { enrichEvent } from "./wide-event"

const SECURE_COOKIE_NAME = "__Secure-better-auth.session_token"
const DEV_COOKIE_NAME = "better-auth.session_token"

export const requireAuth: Effect.Effect<
  { userId: string },
  AuthError,
  HttpServerRequest.HttpServerRequest | AppConfig
> = Effect.gen(function* () {
  const config = yield* AppConfig
  const request = yield* HttpServerRequest.HttpServerRequest
  const cookies = request.cookies

  let sessionToken = cookies[SECURE_COOKIE_NAME]
  let cookieName = SECURE_COOKIE_NAME

  if (!sessionToken) {
    sessionToken = cookies[DEV_COOKIE_NAME]
    cookieName = DEV_COOKIE_NAME
  }

  if (!sessionToken) {
    return yield* new AuthError({ message: "Unauthorized", code: "NO_SESSION" })
  }

  const result = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${config.convex.httpUrl}/api/auth/get-session`, {
        headers: { Cookie: `${cookieName}=${sessionToken}` },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { error: "UNAUTHORIZED" as const }
        }
        return { error: "AUTH_UPSTREAM_ERROR" as const, status: response.status }
      }

      const session = (await response.json()) as { user?: { id?: string } }
      if (!session?.user?.id) {
        return { error: "UNAUTHORIZED" as const }
      }

      return { userId: session.user.id }
    },
    catch: (error) => {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return new AuthError({ message: "Auth service timeout", code: "AUTH_TIMEOUT" })
      }
      return new AuthError({
        message: error instanceof Error ? error.message : "Unknown error",
        code: "AUTH_SERVICE_ERROR",
      })
    },
  })

  if ("error" in result) {
    if (result.error === "AUTH_UPSTREAM_ERROR") {
      yield* enrichEvent({
        error: {
          category: "auth",
          message: `Auth service returned ${(result as { status: number }).status}`,
          code: "AUTH_UPSTREAM_ERROR",
        },
      })
      return yield* new AuthError({ message: "Auth service unavailable", code: "AUTH_UPSTREAM_ERROR" })
    }
    return yield* new AuthError({ message: "Unauthorized", code: "UNAUTHORIZED" })
  }

  yield* enrichEvent({ userId: result.userId } as Record<string, unknown>)
  return { userId: result.userId }
})
