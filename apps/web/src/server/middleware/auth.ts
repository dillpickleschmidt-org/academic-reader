import { createMiddleware } from "hono/factory"
import { getCookie } from "hono/cookie"

// Extend Hono's context variable types
declare module "hono" {
  interface ContextVariableMap {
    userId: string
  }
}

// Convex HTTP actions URL (auth endpoints)
function getConvexHttpUrl(): string {
  const url = process.env.CONVEX_HTTP_URL
  const isDev = process.env.NODE_ENV === "development"

  if (!url) {
    if (isDev) {
      return "http://localhost:3211"
    }
    throw new Error("CONVEX_HTTP_URL is required in production")
  }

  // Allow HTTP for localhost/127.0.0.1 and internal Docker hostnames (no dots)
  const hostname = new URL(url).hostname
  const isLocalOrInternal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    !hostname.includes(".") // Docker service names don't have dots
  if (!isLocalOrInternal && !url.startsWith("https://")) {
    throw new Error("CONVEX_HTTP_URL must use HTTPS for non-local hosts")
  }

  return url
}

const CONVEX_HTTP_URL = getConvexHttpUrl()

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
        // Differentiate auth failure (401/403) from upstream errors (5xx)
        if (response.status === 401 || response.status === 403) {
          return c.json({ error: "Unauthorized" }, 401)
        }
        // Upstream service error - return 502 to indicate gateway issue
        const event = c.get("event")
        if (event) {
          event.error = {
            category: "auth",
            message: "Auth service returned error",
            code: "AUTH_UPSTREAM_ERROR",
          }
        }
        console.error(`[auth] Upstream error: ${response.status}`)
        return c.json({ error: "Auth service unavailable" }, 502)
      }

      const session = (await response.json()) as { user?: { id?: string } }
      if (!session?.user?.id) {
        return c.json({ error: "Unauthorized" }, 401)
      }

      // Store userId on context for downstream handlers
      c.set("userId", session.user.id)

      await next()
    } catch (error) {
      const event = c.get("event")
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        if (event) {
          event.error = { category: "auth", message: "Auth service timeout", code: "AUTH_TIMEOUT" }
        }
        return c.json({ error: "Auth service timeout" }, 504)
      }
      const message = error instanceof Error ? error.message : "Unknown error"
      if (event) {
        event.error = { category: "auth", message, code: "AUTH_SERVICE_ERROR" }
      }
      return c.json({ error: "Auth service unavailable" }, 502)
    }
  },
)

