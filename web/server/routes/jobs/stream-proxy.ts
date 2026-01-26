/**
 * SSE stream proxy for local backend (Marker and LightOnOCR workers).
 *
 * Proxies the worker's SSE stream while processing events:
 * - html_ready: Apply HTML transforms for early preview
 * - completed: Upload images, rewrite URLs, save to S3
 */

import type { WideEvent } from "../../types"
import type { Storage } from "../../storage/types"
import { processHtml } from "../../utils/html-processing"
import { transformSSEStream } from "../../utils/sse-transform"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"
import { emitStreamingEvent } from "../../middleware/wide-event-middleware"
import { activateWorker } from "../../workers/registry"
import {
  processCompletedJob,
  getJobFileInfo,
  clearJobFileInfo,
  HTML_TRANSFORMS,
  SSE_HEADERS,
} from "./processing"

interface StreamProxyOptions {
  jobId: string
  streamUrl: string
  storage: Storage
  event: WideEvent
}

/** Format SSE event for sending */
function formatSSE(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Handle streaming job by proxying local backend SSE stream.
 * Emits "Loading model" progress while activating the worker.
 */
export async function handleStreamingJob(
  options: StreamProxyOptions,
): Promise<Response> {
  const { jobId, streamUrl, storage, event } = options
  const fileInfo = getJobFileInfo(jobId)
  const streamStart = performance.now()
  const encoder = new TextEncoder()

  // Create a custom stream that handles model loading + worker proxy
  const stream = new ReadableStream({
    async start(controller) {
      // Emit loading model progress (if worker is set, indicating local mode)
      if (fileInfo?.worker) {
        controller.enqueue(
          encoder.encode(formatSSE("progress", { stage: "Loading model", current: 0, total: 0 })),
        )

        const activateResult = await tryCatch(activateWorker(fileInfo.worker))
        if (!activateResult.success) {
          event.error = {
            category: "backend",
            message: getErrorMessage(activateResult.error),
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
      const responseResult = await tryCatch(fetch(streamUrl))
      if (!responseResult.success) {
        event.error = {
          category: "network",
          message: getErrorMessage(responseResult.error),
          code: "STREAM_CONNECT_ERROR",
        }
        controller.enqueue(
          encoder.encode(formatSSE("failed", { error: "Failed to connect to worker" })),
        )
        controller.close()
        emitStreamingEvent(event)
        return
      }

      if (!responseResult.data.ok || !responseResult.data.body) {
        event.error = {
          category: "backend",
          message: "Stream not available",
          code: "STREAM_NOT_OK",
        }
        controller.enqueue(
          encoder.encode(formatSSE("failed", { error: "Worker stream not available" })),
        )
        controller.close()
        emitStreamingEvent(event)
        return
      }

      // Transform and pipe worker stream
      const transformedStream = transformSSEStream(
        responseResult.data.body,
        // Sync transform for non-completed events (progress, html_ready)
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
        // Async handler for completed event - upload images and rewrite URLs
        async (data) => {
          try {
            const parsed = JSON.parse(data)

            const { content, imageUrls } = await processCompletedJob(
              jobId,
              parsed,
              fileInfo,
              storage,
              event,
            )

            parsed.content = content
            parsed.jobId = jobId
            parsed.fileId = fileInfo?.fileId
            if (imageUrls) parsed.images = imageUrls

            // Strip markdown from client payload (saved to S3, not needed by client)
            if (parsed.formats?.markdown) {
              delete parsed.formats.markdown
            }

            clearJobFileInfo(jobId)

            emitStreamingEvent(event, {
              durationMs: Math.round(performance.now() - streamStart),
              status: 200,
            })

            return JSON.stringify(parsed)
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

      // Pipe transformed stream to our controller
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

  return new Response(stream, { headers: SSE_HEADERS })
}
