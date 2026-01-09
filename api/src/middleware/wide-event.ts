/**
 * Wide event middleware for structured request logging.
 *
 * - Initializes event at request start
 * - Makes event accessible via c.get('event')
 * - Emits event at request end (except for SSE routes)
 */

import { createMiddleware } from "hono/factory"
import type { WideEvent } from "../types"
import { createWideEvent, emitEvent } from "../utils/wide-event"

// Extend Hono's context variable types
declare module "hono" {
  interface ContextVariableMap {
    event: WideEvent
  }
}

// Routes that use streaming responses (don't emit on response end)
// These routes emit events manually when the stream completes
const STREAMING_ROUTES = ["/api/jobs/*/stream", "/api/chat"]

/**
 * Check if a path matches a streaming route.
 * Supports * as single-segment wildcard.
 */
function isStreamingRoute(path: string): boolean {
  const pathParts = path.split("/")
  return STREAMING_ROUTES.some((route) => {
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

  // Check if this is a streaming route
  const isStreaming = isStreamingRoute(c.req.path)
  if (isStreaming) {
    event.isStreaming = true
  }

  try {
    await next()
  } finally {
    event.durationMs = Math.round(performance.now() - start)
    event.status = c.res.status

    // For non-streaming routes, emit the event now
    // Streaming routes emit via emitStreamingEvent() when stream completes
    if (!isStreaming) {
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
