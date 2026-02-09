import { FiberRef, Effect, Layer } from "effect"
import { HttpMiddleware, HttpServerRequest } from "@effect/platform"
import { SeverityNumber } from "@opentelemetry/api-logs"
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
} from "@opentelemetry/sdk-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"
import type {
  BackendType,
  ProcessingMode,
} from "@academic-reader/api-client/schemas/common"

export type ErrorCategory =
  | "storage"
  | "backend"
  | "convex"
  | "auth"
  | "validation"
  | "network"
  | "internal"
  | "timeout"
  | "configuration"

export interface WideEventError {
  category: ErrorCategory
  message: string
  code?: string
}

export interface WideEvent {
  requestId: string
  timestamp: string
  service: string
  version: string
  environment: string
  deployment: "dev" | "prod"
  method: string
  path: string
  status?: number
  durationMs?: number
  fileId?: string | null
  jobId?: string
  documentId?: string
  backend?: BackendType
  filename?: string
  fileSize?: number
  contentType?: string
  processingMode?: ProcessingMode
  useLlm?: boolean
  error?: WideEventError
  warning?: { message: string; code: string }
  isStreaming?: boolean
  manualEmit?: boolean
  streamEvents?: number
  cleanup?: {
    reason: "cancelled" | "failed" | "timeout" | "client_disconnect"
    cleaned: boolean
    documentPath?: string
  }
  [key: string]: unknown
}

export const WideEventRef = FiberRef.unsafeMake<WideEvent>({
  requestId: "",
  timestamp: "",
  service: "academic-reader-api",
  version: "0.0.0",
  environment: "",
  deployment: "dev",
  method: "",
  path: "",
})

export const enrichEvent = (fields: Partial<WideEvent>) =>
  FiberRef.update(WideEventRef, (e) => ({ ...e, ...fields }))

export const getEvent = FiberRef.get(WideEventRef)

// OTel logger setup
const SERVICE_VERSION = "2.0.0"

function createOtelLogger(endpoint?: string) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "academic-reader-api",
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  })

  const processor = endpoint
    ? new BatchLogRecordProcessor(
        new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      )
    : new BatchLogRecordProcessor(new ConsoleLogRecordExporter())

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [processor],
  })
  return loggerProvider.getLogger("wide-events")
}

let otelLogger: ReturnType<typeof createOtelLogger> | undefined

function getOtelLogger(endpoint?: string) {
  if (!otelLogger) {
    otelLogger = createOtelLogger(endpoint)
  }
  return otelLogger
}

function emitEvent(event: WideEvent, otelEndpoint?: string) {
  const clean = Object.fromEntries(
    Object.entries(event)
      .filter(([, v]) => v != null)
      .map(([k, v]) => {
        if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          return [k, v]
        }
        return [k, JSON.stringify(v)]
      }),
  ) as Record<string, string | number | boolean>

  const severityNumber = event.error
    ? SeverityNumber.ERROR
    : SeverityNumber.INFO
  const severityText = event.error ? "ERROR" : "INFO"

  getOtelLogger(otelEndpoint).emit({
    severityNumber,
    severityText,
    attributes: clean,
  })
}

export function emitStreamingEvent(
  event: WideEvent,
  extra?: Partial<WideEvent>,
  otelEndpoint?: string,
) {
  if (extra) Object.assign(event, extra)
  emitEvent(event, otelEndpoint)
}

// Routes that call emitStreamingEvent() manually
const MANUAL_EMIT_ROUTES = [
  "/api/jobs/*/stream",
  "/api/chat",
  "/api/documents/*/embeddings",
  "/api/tts/chunk",
]

function isManualEmitRoute(path: string): boolean {
  const pathParts = path.split("/")
  return MANUAL_EMIT_ROUTES.some((route) => {
    const routeParts = route.split("/")
    if (pathParts.length !== routeParts.length) return false
    return routeParts.every((part, i) => part === "*" || part === pathParts[i])
  })
}

export const wideEventMiddleware = (
  backendMode: string,
  siteUrl?: string,
  otelEndpoint?: string,
) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const start = performance.now()
      const path = request.url

      const event: WideEvent = {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        service: "academic-reader-api",
        version: SERVICE_VERSION,
        environment: backendMode,
        deployment: siteUrl?.includes("localhost") ? "dev" : "prod",
        method: request.method,
        path,
      }

      const manualEmit = isManualEmitRoute(path)
      if (manualEmit && path.includes("/stream")) {
        event.isStreaming = true
      }
      event.manualEmit = manualEmit

      yield* FiberRef.set(WideEventRef, event)

      const response = yield* Effect.onExit(app, (exit) =>
        Effect.sync(() => {
          if (!manualEmit) {
            event.durationMs = Math.round(performance.now() - start)
            if (exit._tag === "Failure") {
              event.error = {
                category: "internal",
                message: "Request failed",
                code: "UNCAUGHT_ERROR",
              }
            }
            emitEvent(event, otelEndpoint)
          }
        }),
      )

      event.status = response.status
      return response
    }),
  )
