import { createMiddleware } from "hono/factory"
import { getCookie } from "hono/cookie"

// Convex HTTP actions URL (auth endpoints)
// Defaults to localhost for local development
const CONVEX_HTTP_URL =
  process.env.CONVEX_HTTP_URL || "http://localhost:3211"

export const requireAuth = createMiddleware(
  async (c, next) => {
    // Cookie name has __Secure- prefix in production (HTTPS)
    const secureCookieName = "__Secure-better-auth.session_token"
    const devCookieName = "better-auth.session_token"

    let sessionToken = getCookie(c, secureCookieName)
    let cookieName = secureCookieName

    if (!sessionToken) {
      sessionToken = getCookie(c, devCookieName)
      cookieName = devCookieName
    }

    if (!sessionToken) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    try {
      const response = await fetch(`${CONVEX_HTTP_URL}/api/auth/get-session`, {
        headers: { Cookie: `${cookieName}=${sessionToken}` },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return c.json({ error: "Unauthorized" }, 401)
      }

      const session = (await response.json()) as { user?: unknown }
      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401)
      }

      await next()
    } catch (error) {
      const event = c.get("event")
      if (error instanceof Error && error.name === "TimeoutError") {
        event.error = { category: "auth", message: "Auth service timeout", code: "AUTH_TIMEOUT" }
        return c.json({ error: "Auth service timeout" }, 504)
      }
      if (error instanceof Error && error.name === "AbortError") {
        event.error = { category: "auth", message: "Auth service timeout", code: "AUTH_TIMEOUT" }
        return c.json({ error: "Auth service timeout" }, 504)
      }
      const message = error instanceof Error ? error.message : "Unknown error"
      event.error = { category: "auth", message, code: "AUTH_SERVICE_ERROR" }
      return c.json({ error: "Auth service unavailable" }, 502)
    }
  },
)
