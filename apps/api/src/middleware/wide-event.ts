import { inspect } from "node:util"
import { Cause, Context, Effect, Exit, Result } from "effect"
import { HttpMiddleware, HttpServerRequest } from "effect/unstable/http"
import { SeverityNumber } from "@opentelemetry/api-logs"
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"
import type { BackendType } from "@academic-reader/api-client/schemas/common"

type ErrorCategory = "auth" | "convex" | "internal" | "validation"

type TtsBackendType = "local" | "modal" | "none"

interface WideEventError {
  category: ErrorCategory
  message: string
  code?: string
}

interface WideEventMiddlewareContext {
  environment: string
  conversionBackend: BackendType
  ttsBackend: TtsBackendType
}

export interface WideEvent extends Record<string, unknown> {
  requestId: string
  timestamp: string
  environment: string
  method: string
  path: string
  conversionBackend: BackendType
  ttsBackend: TtsBackendType
  status?: number
  durationMs?: number
  startTimeMs?: number
  error?: WideEventError
}

const SERVICE_NAME = "academic-reader-api"
const SERVICE_VERSION = "2.0.0"

const WideEventRef = Context.Reference<WideEvent>("WideEventRef", {
  defaultValue: (): WideEvent => ({
    requestId: "",
    timestamp: "",
    environment: "",
    method: "",
    path: "",
    conversionBackend: "local",
    ttsBackend: "none",
  }),
})

export const enrichEvent = (fields: Record<string, unknown>) =>
  Effect.gen(function* () {
    const event = yield* WideEventRef
    Object.assign(event, fields)
  })

export const getEvent = WideEventRef

function createOtelLogger(endpoint?: string) {
  if (!endpoint) return undefined

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  })

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      ),
    ],
  })
  return loggerProvider.getLogger("wide-events")
}

let otelLogger: ReturnType<typeof createOtelLogger>

function getOtelLogger(endpoint?: string) {
  if (!otelLogger) otelLogger = createOtelLogger(endpoint)
  return otelLogger
}

function emitEvent(event: WideEvent, otelEndpoint?: string) {
  const completed = completeEvent(event)
  const severityText = completed.error ? "ERROR" : "INFO"

  if (!otelEndpoint) {
    process.stdout.write(
      `${inspect({
        severity: severityText,
        ...eventAttributes(completed),
      }, { colors: true, depth: null, compact: false })}\n`,
    )
    return
  }

  const logger = getOtelLogger(otelEndpoint)
  if (!logger) return

  logger.emit({
    severityNumber: completed.error ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText,
    attributes: eventAttributes(completed),
  })
}

export function emitStreamingEvent(
  event: WideEvent,
  extra?: Record<string, unknown>,
  otelEndpoint?: string,
) {
  emitEvent({ ...event, ...extra } as WideEvent, otelEndpoint)
}

export function emitLifecycleEvent(
  fields: Record<string, unknown> & { eventName: string },
  otelEndpoint?: string,
) {
  emitEvent(
    {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      environment: String(
        fields.environment || process.env.APP_ENV || process.env.NODE_ENV || "dev",
      ),
      method: "LIFECYCLE",
      path: "/lifecycle",
      conversionBackend: "local",
      ttsBackend: "none",
      ...fields,
    } as WideEvent,
    otelEndpoint,
  )
}

export const wideEventMiddleware = (
  context: WideEventMiddlewareContext,
  otelEndpoint?: string,
) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const start = performance.now()
      const path = new URL(request.url, "http://localhost").pathname
      const requestId = requestHeader(request.headers, "x-request-id")
        || crypto.randomUUID()

      const event: WideEvent = {
        requestId,
        timestamp: new Date().toISOString(),
        environment: context.environment,
        method: request.method,
        path,
        startTimeMs: start,
        conversionBackend: context.conversionBackend,
        ttsBackend: context.ttsBackend,
      }

      const manualEmit = path === "/api/chat"

      const response = yield* app.pipe(
        Effect.provideService(WideEventRef, event),
        Effect.tap((res) =>
          Effect.sync(() => {
            event.status = res.status
          }),
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (manualEmit && Exit.isSuccess(exit)) return
            if (manualEmit && (event.status !== undefined || event.error)) return

            if (Exit.isFailure(exit)) {
              const details = failureDetails(failureFromCause(exit.cause))
              event.status = event.status ?? details.status
              event.error = event.error ?? details.error
            }

            emitEvent(event, otelEndpoint)
          }),
        ),
      )

      return response
    }),
  )

function failureFromCause(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.findError(cause)
  return Result.isSuccess(error) ? error.success : undefined
}

function failureDetails(error: unknown): { status: number; error: WideEventError } {
  if (error instanceof Cause.NoSuchElementError) {
    return {
      status: 404,
      error: { category: "validation", message: "Not Found", code: "NOT_FOUND" },
    }
  }

  const tag = tagForError(error)
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Request failed"
  return {
    status: tag === "ValidationError"
      ? 400
      : tag === "AuthError"
        ? 401
        : tag === "BackendError" ? 502 : 500,
    error: {
      category: tag === "ValidationError"
        ? "validation"
        : tag === "AuthError" ? "auth" : "internal",
      message,
      code: tag
        ? tag.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()
        : "UNCAUGHT_ERROR",
    },
  }
}

function tagForError(error: unknown) {
  return error && typeof error === "object" && "_tag" in error
    ? String(error._tag)
    : undefined
}

function completeEvent(event: WideEvent): WideEvent {
  if (event.durationMs !== undefined) return event
  if (typeof event.startTimeMs !== "number") return event
  return {
    ...event,
    durationMs: Math.round(performance.now() - event.startTimeMs),
  }
}

function eventAttributes(event: WideEvent): Record<string, string | number | boolean> {
  const attributes = Object.fromEntries(
    Object.entries(event)
      .filter(([, value]) => value != null)
      .filter(([key]) => !["startTimeMs", "error"].includes(key))
      .map(([key, value]) => [key, attributeValue(value)]),
  ) as Record<string, string | number | boolean>

  if (event.error) {
    attributes.errorCategory = event.error.category
    attributes.errorMessage = event.error.message
    if (event.error.code) attributes.errorCode = event.error.code
  }

  return attributes
}

function attributeValue(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  return JSON.stringify(value)
}

function requestHeader(
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}
