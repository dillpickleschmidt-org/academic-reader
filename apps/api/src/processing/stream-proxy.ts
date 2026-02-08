import { Effect } from "effect"
import { HttpServerResponse } from "@effect/platform"
import type { WideEvent } from "../middleware/wide-event"
import { emitStreamingEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"
import { transformSSEStream } from "../utils/sse-transform"
import { processCompletedJob, SSE_HEADERS, type JobResultInput } from "./completed-job"
import { JobFileMap, type JobFileEntry } from "../services/job-file-map"
import { TtsService } from "../services/backends/tts"

function formatSSE(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

export function handleStreamingJob(
  jobId: string,
  streamUrl: string,
  event: WideEvent,
  fileInfo: JobFileEntry | undefined,
  requestCookies: Record<string, string>,
) {
  return Effect.gen(function* () {
    const config = yield* AppConfig
    const storage = yield* Storage
    const ttsService = yield* TtsService
    const jobFileMap = yield* JobFileMap
    const streamStart = performance.now()
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        // Emit loading model progress
        if (fileInfo?.workerType) {
          controller.enqueue(
            encoder.encode(formatSSE("progress", { stage: "Loading model", current: 0, total: 0 })),
          )

          try {
            await new Promise<void>((resolve, reject) => {
              const workerName = fileInfo.workerType === "lightonocr" ? "lightonocr" : "marker"
              // Simple health check to activate worker
              fetch(`${streamUrl.replace(/\/jobs\/.*/, "/health")}`, {
                signal: AbortSignal.timeout(30000),
              }).then(() => resolve()).catch(reject)
            })
          } catch (err) {
            event.error = {
              category: "backend",
              message: err instanceof Error ? err.message : String(err),
              code: "WORKER_ACTIVATE_ERROR",
            }
            controller.enqueue(
              encoder.encode(formatSSE("failed", { error: "Failed to load model" })),
            )
            controller.close()
            emitStreamingEvent(event)
            return
          }
        }

        // Connect to worker stream
        let response: Response
        try {
          response = await fetch(streamUrl)
        } catch (err) {
          event.error = {
            category: "network",
            message: err instanceof Error ? err.message : String(err),
            code: "STREAM_CONNECT_ERROR",
          }
          controller.enqueue(
            encoder.encode(formatSSE("failed", { error: "Failed to connect to worker" })),
          )
          controller.close()
          emitStreamingEvent(event)
          return
        }

        if (!response.ok || !response.body) {
          event.error = { category: "backend", message: "Stream not available", code: "STREAM_NOT_OK" }
          controller.enqueue(
            encoder.encode(formatSSE("failed", { error: "Worker stream not available" })),
          )
          controller.close()
          emitStreamingEvent(event)
          return
        }

        const transformedStream = transformSSEStream(
          response.body,
          (sseEvent, data) => {
            if (sseEvent === "html_ready") {
              try {
                const parsed = JSON.parse(data)
                if (parsed.content) {
                  parsed.content = processHtml(parsed.content, HTML_TRANSFORMS)
                }
                return JSON.stringify(parsed)
              } catch {
                return data
              }
            }
            return data
          },
          async (data) => {
            try {
              const parsed = JSON.parse(data) as JobResultInput

              // Run processCompletedJob as a promise
              const result = await Effect.runPromise(
                processCompletedJob(jobId, parsed, fileInfo, event, requestCookies).pipe(
                  Effect.provideService(AppConfig, config),
                  Effect.provideService(Storage, storage as any),
                ),
              )

              const output: any = { ...parsed }
              output.content = result.content
              output.jobId = jobId
              output.fileId = fileInfo?.fileId
              if (output.formats?.chunks) output.formats.chunks.blocks = result.blocks
              if (result.imageUrls) output.images = result.imageUrls
              if (result.documentId) output.documentId = result.documentId

              if (output.formats?.markdown) {
                delete output.formats.markdown
              }

              emitStreamingEvent(event, {
                durationMs: Math.round(performance.now() - streamStart),
                status: 200,
              })

              return JSON.stringify(output)
            } catch (err) {
              event.error = {
                category: "internal",
                message: err instanceof Error ? err.message : String(err),
                code: "COMPLETED_EVENT_PROCESSING_ERROR",
              }
              return data
            }
          },
        )

        const reader = transformedStream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
        } finally {
          reader.releaseLock()
          controller.close()
        }
      },
    })

    return HttpServerResponse.fromWeb(new Response(stream, { headers: SSE_HEADERS }))
  })
}
