/**
 * Polling-based SSE emitter for cloud backends (Modal, Datalab).
 *
 * Polls the backend for job status and emits SSE events to the client.
 * Handles progress, html_ready, completed, and failed states.
 */

import type { WideEvent } from "../../types"
import type { Storage } from "../../storage/types"
import type { ConversionBackend } from "../../backends/interface"
import { POLLING } from "../../constants"
import { processHtml } from "../../utils/html-processing"
import { tryCatch, getErrorMessage } from "../../utils/try-catch"
import { emitStreamingEvent } from "../../middleware/wide-event-middleware"
import {
  processCompletedJob,
  getJobFileInfo,
  clearJobFileInfo,
  handleCleanup,
  HTML_TRANSFORMS,
  SSE_HEADERS,
} from "./processing"

interface PollEmitterOptions {
  jobId: string
  backend: ConversionBackend
  storage: Storage
  event: WideEvent
  signal: AbortSignal
  headers?: Headers
}

type FinalStatus = "completed" | "failed" | "timeout" | "cancelled"

/**
 * Handle polling job by polling backend and emitting SSE events.
 */
export async function handlePollingJob(
  options: PollEmitterOptions,
): Promise<Response> {
  const { jobId, backend, storage, event, signal, headers } = options
  const encoder = new TextEncoder()
  const streamStart = performance.now()
  let eventCount = 0

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventTime = Date.now()
      const KEEPALIVE_INTERVAL_MS = 30_000

      const sendEvent = (sseEvent: string, data: unknown) => {
        eventCount++
        lastEventTime = Date.now()
        controller.enqueue(
          encoder.encode(
            `event: ${sseEvent}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        )
      }

      const sendKeepalive = () => {
        lastEventTime = Date.now()
        controller.enqueue(encoder.encode(":keepalive\n\n"))
      }

      let completed = false
      let pollCount = 0
      let lastProgressKey = ""
      let htmlReadySent = false
      let finalStatus: FinalStatus = "timeout"

      while (!completed && pollCount < POLLING.MAX_POLLS) {
        // Send keepalive if no events sent recently (prevents Cloudflare 524 timeout)
        if (Date.now() - lastEventTime > KEEPALIVE_INTERVAL_MS) {
          sendKeepalive()
          lastEventTime = Date.now()
        }
        // Check if client disconnected
        if (signal.aborted) {
          finalStatus = "cancelled"
          completed = true
          // Cancel backend job and cleanup S3 file
          if (backend.supportsCancellation() && backend.cancelJob) {
            void backend.cancelJob(jobId).catch(() => {})
          }
          handleCleanup(event, jobId, "client_disconnect")
          break
        }

        const jobResult = await tryCatch(backend.getJobStatus(jobId))

        if (!jobResult.success) {
          sendEvent("error", { message: "Failed to get job status" })
          finalStatus = "failed"
          event.error = {
            category: "backend",
            message: getErrorMessage(jobResult.error),
            code: "POLL_ERROR",
          }
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
          case "completed": {
            const fileInfo = getJobFileInfo(jobId)

            // Check if result was uploaded to S3
            let resultData = job.result

            if (job.s3Result && fileInfo?.documentPath) {
              // Fetch result from S3
              const resultKey = `${fileInfo.documentPath}/result.json`
              try {
                const resultJson = await storage.readFileAsString(resultKey)
                resultData = JSON.parse(resultJson)
                // Clean up the temporary result file
                await storage.deleteFile(resultKey)
              } catch (err) {
                sendEvent("error", { message: "Failed to fetch conversion result" })
                finalStatus = "failed"
                event.error = {
                  category: "storage",
                  message: getErrorMessage(err),
                  code: "S3_FETCH_ERROR",
                }
                completed = true
                break
              }
            }

            // Use result content, falling back to htmlContent
            const resultToProcess = {
              ...resultData,
              content: resultData?.content || job.htmlContent,
            }

            // Emit TOC extraction progress
            sendEvent("progress", { stage: "Extracting table of contents", current: 0, total: 1 })

            const { content, imageUrls, toc, documentId } = await processCompletedJob(
              jobId,
              resultToProcess,
              fileInfo,
              storage,
              event,
              headers,
            )

            // For backends that don't support html_ready (like datalab), send early preview
            if (!htmlReadySent && content) {
              sendEvent("html_ready", { content })
              htmlReadySent = true
            }

            // Strip markdown from client payload (saved to S3, not needed by client)
            const resultForClient = { ...resultData }
            if (resultForClient?.formats?.markdown) {
              const { markdown: _, ...formatsWithoutMarkdown } = resultForClient.formats
              resultForClient.formats = formatsWithoutMarkdown as typeof resultForClient.formats
            }

            // Send completed event with fileId for downloads
            sendEvent("completed", {
              ...resultForClient,
              content,
              ...(imageUrls && { images: imageUrls }),
              ...(toc && { toc }),
              ...(documentId && { documentId }),
              jobId,
              fileId: fileInfo?.fileId,
            })
            finalStatus = "completed"
            clearJobFileInfo(jobId)
            completed = true
            break
          }
          case "failed": {
            sendEvent("failed", { error: job.error })
            finalStatus = "failed"
            event.error = {
              category: "backend",
              message: job.error || "Job failed",
              code: "JOB_FAILED",
            }
            handleCleanup(event, jobId, "failed")
            completed = true
            break
          }
          case "html_ready":
            if (!htmlReadySent) {
              // Apply reader enhancements (block IDs already added by Marker)
              if (job.htmlContent) {
                job.htmlContent = processHtml(job.htmlContent, HTML_TRANSFORMS)
              }
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
      }

      if (!completed) {
        sendEvent("error", { message: "Polling timeout" })
        event.error = {
          category: "backend",
          message: "Polling timeout",
          code: "POLL_TIMEOUT",
        }
        // Cleanup on timeout
        if (backend.supportsCancellation() && backend.cancelJob) {
          void backend.cancelJob(jobId).catch(() => {})
        }
        handleCleanup(event, jobId, "timeout")
      }

      controller.close()

      // Emit wide event when stream completes
      emitStreamingEvent(event, {
        streamEvents: eventCount,
        durationMs: Math.round(performance.now() - streamStart),
        status:
          finalStatus === "completed"
            ? 200
            : finalStatus === "cancelled"
              ? 499
              : 500,
        pollCount,
      })
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
