import { createMiddleware } from "hono/factory"
import { getCookie } from "hono/cookie"
import type { Context } from "hono"

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

// Cookie names
const SECURE_COOKIE_NAME = "__Secure-better-auth.session_token"
const DEV_COOKIE_NAME = "better-auth.session_token"

/**
 * Get authenticated user from session cookie.
 * Returns { userId } if authenticated, null otherwise.
 * Use this directly in routes that need optional auth.
 */
export async function getAuth(c: Context): Promise<{ userId: string } | null> {
  let sessionToken = getCookie(c, SECURE_COOKIE_NAME)
  let cookieName = SECURE_COOKIE_NAME

  if (!sessionToken) {
    sessionToken = getCookie(c, DEV_COOKIE_NAME)
    cookieName = DEV_COOKIE_NAME
  }

  if (!sessionToken) {
    return null
  }

  try {
    const response = await fetch(`${CONVEX_HTTP_URL}/api/auth/get-session`, {
      headers: { Cookie: `${cookieName}=${sessionToken}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return null
    }

    const session = (await response.json()) as { user?: { id?: string } }
    if (!session?.user?.id) {
      return null
    }

    return { userId: session.user.id }
  } catch {
    return null
  }
}

/**
 * Middleware that requires authentication.
 * Returns 401/502/504 on failure, sets userId on context on success.
 */
export const requireAuth = createMiddleware(async (c, next) => {
  let sessionToken = getCookie(c, SECURE_COOKIE_NAME)
  let cookieName = SECURE_COOKIE_NAME

  if (!sessionToken) {
    sessionToken = getCookie(c, DEV_COOKIE_NAME)
    cookieName = DEV_COOKIE_NAME
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
      if (response.status === 401 || response.status === 403) {
        return c.json({ error: "Unauthorized" }, 401)
      }
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
})

