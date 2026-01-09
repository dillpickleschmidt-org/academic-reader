import { Hono } from "hono"
import type { BackendType, ConversionJob } from "../types"
import { createBackend } from "../backends/factory"
import { LocalBackend } from "../backends/local"
import { POLLING } from "../constants"
import { enhanceHtmlForReader } from "../utils/html-processing"
import { transformSSEStream } from "../utils/sse-transform"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event"

export const jobs = new Hono()

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const

function enhanceJobHtml(job: ConversionJob): void {
  if (job.result?.content) {
    job.result.content = enhanceHtmlForReader(job.result.content)
  }
  if (job.htmlContent) {
    job.htmlContent = enhanceHtmlForReader(job.htmlContent)
  }
}

jobs.get("/jobs/:jobId/stream", async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const backendType = process.env.BACKEND_MODE || "local"

  event.jobId = jobId
  event.backend = backendType as BackendType

  const backendResult = await tryCatch(async () => createBackend())
  if (!backendResult.success) {
    event.error = { category: "backend", message: getErrorMessage(backendResult.error), code: "BACKEND_INIT_ERROR" }
    emitStreamingEvent(event)
    return c.json({ error: "Failed to initialize backend" }, 500)
  }
  const backend = backendResult.data

  // For local backend, proxy SSE stream with HTML enhancement
  if (backend.supportsStreaming() && backend instanceof LocalBackend) {
    const streamUrl = backend.getStreamUrl!(jobId)

    const responseResult = await tryCatch(fetch(streamUrl))
    if (!responseResult.success) {
      event.error = { category: "network", message: getErrorMessage(responseResult.error), code: "STREAM_CONNECT_ERROR" }
      emitStreamingEvent(event)
      return c.json({ error: "Failed to connect to stream" }, 500)
    }

    if (!responseResult.data.ok || !responseResult.data.body) {
      event.error = { category: "backend", message: "Stream not available", code: "STREAM_NOT_OK" }
      emitStreamingEvent(event)
      return c.json({ error: "Failed to connect to stream" }, 500)
    }

    // Transform SSE events to enhance HTML content
    const transformedStream = transformSSEStream(
      responseResult.data.body,
      (sseEvent, data) => {
        if (sseEvent === "html_ready" || sseEvent === "completed") {
          try {
            const parsed = JSON.parse(data)
            if (parsed.content) {
              parsed.content = enhanceHtmlForReader(parsed.content)
            }
            return JSON.stringify(parsed)
          } catch {
            return data
          }
        }
        return data
      },
    )

    // Tee the stream: one for response, one for tracking completion
    const streamStart = performance.now()
    const [streamForResponse, streamForTracking] = transformedStream.tee()

    streamForTracking.pipeTo(new WritableStream()).finally(() => {
      emitStreamingEvent(event, {
        durationMs: Math.round(performance.now() - streamStart),
        status: 200,
      })
    })

    return new Response(streamForResponse, { headers: SSE_HEADERS })
  }

  // For cloud backends, poll and emit SSE events
  const encoder = new TextEncoder()
  const streamStart = performance.now()
  let eventCount = 0

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (sseEvent: string, data: unknown) => {
        eventCount++
        controller.enqueue(
          encoder.encode(`event: ${sseEvent}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      let completed = false
      let pollCount = 0
      let lastProgressKey = ""
      let htmlReadySent = false
      let finalStatus: "completed" | "failed" | "timeout" = "timeout"

      while (!completed && pollCount < POLLING.MAX_POLLS) {
        const jobResult = await tryCatch(backend.getJobStatus(jobId))

        if (!jobResult.success) {
          sendEvent("error", { message: "Failed to get job status" })
          finalStatus = "failed"
          event.error = { category: "backend", message: getErrorMessage(jobResult.error), code: "POLL_ERROR" }
          completed = true
          break
        }
        const job = jobResult.data

        if (job.progress) {
          const key = `${job.progress.stage}:${job.progress.current}:${job.progress.total}`
          if (key !== lastProgressKey) {
            sendEvent("progress", job.progress)
            lastProgressKey = key
          }
        }

        switch (job.status) {
          case "completed":
            enhanceJobHtml(job)
            sendEvent("completed", job.result)
            finalStatus = "completed"
            completed = true
            break
          case "failed":
            sendEvent("failed", { error: job.error })
            finalStatus = "failed"
            event.error = { category: "backend", message: job.error || "Job failed", code: "JOB_FAILED" }
            completed = true
            break
          case "html_ready":
            if (!htmlReadySent) {
              enhanceJobHtml(job)
              sendEvent("html_ready", { content: job.htmlContent })
              htmlReadySent = true
            }
            break
        }

        if (!completed) {
          await new Promise((resolve) => setTimeout(resolve, POLLING.INTERVAL_MS))
          pollCount++
        }
      }

      if (!completed) {
        sendEvent("error", { message: "Polling timeout" })
        event.error = { category: "backend", message: "Polling timeout", code: "POLL_TIMEOUT" }
      }

      controller.close()

      // Emit wide event when stream completes
      emitStreamingEvent(event, {
        streamEvents: eventCount,
        durationMs: Math.round(performance.now() - streamStart),
        status: finalStatus === "completed" ? 200 : 500,
        pollCount,
      })
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
