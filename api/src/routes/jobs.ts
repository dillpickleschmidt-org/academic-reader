import { Hono } from "hono"
import type { Env, ConversionJob } from "../types"
import { createBackend } from "../backends/factory"
import { LocalBackend } from "../backends/local"
import { POLLING } from "../constants"
import { enhanceHtmlForReader } from "../utils/html-processing"
import { transformSSEStream } from "../utils/sse-transform"

export const jobs = new Hono<{ Bindings: Env }>()

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
  const jobId = c.req.param("jobId")
  const backend = createBackend(c.env)

  // For local backend, proxy SSE stream with HTML enhancement
  if (backend.supportsStreaming() && backend instanceof LocalBackend) {
    const streamUrl = backend.getStreamUrl!(jobId)
    const response = await fetch(streamUrl)

    if (!response.ok || !response.body) {
      return c.json({ error: "Failed to connect to stream" }, 500)
    }

    // Transform SSE events to enhance HTML content
    const transformedStream = transformSSEStream(
      response.body,
      (event, data) => {
        if (event === "html_ready" || event === "completed") {
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

    return new Response(transformedStream, { headers: SSE_HEADERS })
  }

  // For cloud backends, poll and emit SSE events
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        )
      }

      let completed = false
      let pollCount = 0
      let lastProgressKey = ""
      let htmlReadySent = false

      while (!completed && pollCount < POLLING.MAX_POLLS) {
        try {
          const job = await backend.getJobStatus(jobId)

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
              completed = true
              break
            case "failed":
              sendEvent("failed", { error: job.error })
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
            await new Promise((resolve) =>
              setTimeout(resolve, POLLING.INTERVAL_MS),
            )
            pollCount++
          }
        } catch (error) {
          sendEvent("error", { message: "Failed to get job status" })
          completed = true
        }
      }

      if (!completed) {
        sendEvent("error", { message: "Polling timeout" })
      }

      controller.close()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
