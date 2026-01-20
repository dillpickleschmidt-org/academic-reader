/**
 * Wide event middleware for structured request logging.
 *
 * - Initializes event at request start
 * - Makes event accessible via c.get('event')
 * - Emits event at request end (except for SSE routes)
 */

import { createMiddleware } from "hono/factory"
import type { WideEvent } from "../types"
import { createWideEvent, emitEvent } from "../utils/wide-event-logger"

// Extend Hono's context variable types
declare module "hono" {
  interface ContextVariableMap {
    event: WideEvent
  }
}

// Routes that call emitStreamingEvent() manually
const MANUAL_EMIT_ROUTES = ["/api/jobs/*/stream", "/api/chat", "/api/documents/*/embeddings", "/api/tts/chunk"]

/**
 * Check if a path matches a manual-emit route.
 * Supports * as single-segment wildcard.
 */
function isManualEmitRoute(path: string): boolean {
  const pathParts = path.split("/")
  return MANUAL_EMIT_ROUTES.some((route) => {
    const routeParts = route.split("/")
    if (pathParts.length !== routeParts.length) return false
    return routeParts.every((part, i) => part === "*" || part === pathParts[i])
  })
}

/**
 * Wide event middleware.
 * Captures request lifecycle and emits a single structured log per request.
 */
export const wideEvent = createMiddleware(async (c, next) => {
  const start = performance.now()

  // Create and store wide event
  const event = createWideEvent(c.req.method, c.req.path, {
    backendMode:
      (process.env.BACKEND_MODE as "local" | "runpod" | "datalab") || "local",
    siteUrl: process.env.SITE_URL,
  })
  c.set("event", event)

  const manualEmit = isManualEmitRoute(c.req.path)
  if (manualEmit && c.req.path.includes("/stream")) {
    event.isStreaming = true
  }

  try {
    await next()
  } catch (e) {
    // Capture uncaught errors for logging
    event.error = {
      category: "internal",
      message: e instanceof Error ? e.message : String(e),
      code: "UNCAUGHT_ERROR",
    }
    throw e // Re-throw so Hono returns 500
  } finally {
    if (!manualEmit) {
      event.durationMs = Math.round(performance.now() - start)
      event.status = c.res.status
      emitEvent(event)
    }
  }
})

/**
 * Emit event for SSE streaming routes.
 * Called manually when the stream completes or is cancelled.
 */
export function emitStreamingEvent(
  event: WideEvent,
  extra?: Partial<WideEvent>,
): void {
  if (extra) {
    Object.assign(event, extra)
  }
  emitEvent(event)
}
