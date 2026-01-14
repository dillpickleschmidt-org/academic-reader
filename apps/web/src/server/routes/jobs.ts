import { Hono } from "hono"
import type { BackendType, WideEvent } from "../types"
import type { Storage } from "../storage/types"
import { jobFileMap } from "../storage/job-file-map"
import { resultCache } from "../storage/result-cache"
import { cleanupJob } from "../cleanup"
import { createBackend } from "../backends/factory"
import { LocalBackend } from "../backends/local"
import { POLLING } from "../constants"
import {
  processHtml,
  removeImgDescriptions,
  wrapCitations,
  processParagraphs,
  convertMathToHtml,
  rewriteImageSources,
} from "../utils/html-processing"
import { addPageAttributes } from "../utils/tts-attribution"
import { stripHtmlForEmbedding } from "../services/embeddings"
import { transformSSEStream } from "../utils/sse-transform"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { emitStreamingEvent } from "../middleware/wide-event-middleware"
import type { ChunkInput } from "../services/document-persistence"

type Variables = {
  storage: Storage
}

type CleanupReason = "cancelled" | "failed" | "timeout" | "client_disconnect"

function handleCleanup(
  event: WideEvent,
  jobId: string,
  reason: CleanupReason,
): void {
  const result = cleanupJob(jobId)
  event.cleanup = { reason, ...result }
}

export const jobs = new Hono<{ Variables: Variables }>()

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
} as const

jobs.get("/jobs/:jobId/stream", async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const backendType = process.env.BACKEND_MODE || "local"
  const storage = c.get("storage")

  event.jobId = jobId
  event.backend = backendType as BackendType

  const backendResult = await tryCatch(async () => createBackend())
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    emitStreamingEvent(event)
    return c.json({ error: "Failed to initialize backend" }, 500)
  }
  const backend = backendResult.data

  // For local backend, proxy SSE stream with HTML enhancement
  if (backend.supportsStreaming() && backend instanceof LocalBackend) {
    const streamUrl = backend.getStreamUrl!(jobId)

    const responseResult = await tryCatch(fetch(streamUrl))
    if (!responseResult.success) {
      event.error = {
        category: "network",
        message: getErrorMessage(responseResult.error),
        code: "STREAM_CONNECT_ERROR",
      }
      emitStreamingEvent(event)
      return c.json({ error: "Failed to connect to stream" }, 500)
    }

    if (!responseResult.data.ok || !responseResult.data.body) {
      event.error = {
        category: "backend",
        message: "Stream not available",
        code: "STREAM_NOT_OK",
      }
      emitStreamingEvent(event)
      return c.json({ error: "Failed to connect to stream" }, 500)
    }

    // Transform SSE events to enhance HTML content (no chunks available in stream)
    const transformedStream = transformSSEStream(
      responseResult.data.body,
      (sseEvent, data) => {
        if (sseEvent === "html_ready" || sseEvent === "completed") {
          try {
            const parsed = JSON.parse(data)
            if (parsed.content) {
              parsed.content = processHtml(parsed.content, [
                removeImgDescriptions,
                wrapCitations,
                processParagraphs,
                convertMathToHtml,
              ])
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
  const signal = c.req.raw.signal
  let eventCount = 0

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (sseEvent: string, data: unknown) => {
        eventCount++
        controller.enqueue(
          encoder.encode(
            `event: ${sseEvent}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        )
      }

      let completed = false
      let pollCount = 0
      let lastProgressKey = ""
      let htmlReadySent = false
      let finalStatus: "completed" | "failed" | "timeout" | "cancelled" =
        "timeout"

      while (!completed && pollCount < POLLING.MAX_POLLS) {
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
            const fileInfo = jobFileMap.get(jobId)

            // Upload images to R2 and get public URLs
            let imageUrls: Record<string, string> | undefined
            if (
              job.result?.images &&
              Object.keys(job.result.images).length > 0 &&
              storage.uploadImages &&
              fileInfo?.documentPath
            ) {
              const uploadResult = await tryCatch(
                storage.uploadImages(fileInfo.documentPath, job.result.images),
              )
              if (uploadResult.success) {
                imageUrls = uploadResult.data
                console.log(
                  `[jobs] Uploaded ${Object.keys(imageUrls).length} images to R2`,
                )
              } else {
                console.error(
                  `[jobs] Failed to upload images: ${uploadResult.error}`,
                )
              }
            }

            // Extract chunks first (needed for page attribution)
            const rawChunks = job.result?.formats?.chunks?.blocks ?? []
            const chunks: ChunkInput[] = rawChunks
              .map((chunk) => ({
                blockId: chunk.id,
                blockType: chunk.block_type,
                content: stripHtmlForEmbedding(chunk.html),
                page: chunk.page,
                section: chunk.section_hierarchy
                  ? Object.values(chunk.section_hierarchy)
                      .filter(Boolean)
                      .join(" > ")
                  : undefined,
              }))
              .filter((c) => c.content.trim().length > 0)

            // Rewrite image sources to use R2 URLs
            if (imageUrls) {
              if (job.result?.content) {
                job.result.content = rewriteImageSources(
                  job.result.content,
                  imageUrls,
                )
              }
              if (job.htmlContent) {
                job.htmlContent = rewriteImageSources(job.htmlContent, imageUrls)
              }
              if (job.result?.formats?.html) {
                job.result.formats.html = rewriteImageSources(
                  job.result.formats.html,
                  imageUrls,
                )
              }
            }

            // Enhance HTML with single parse: reader enhancements + page attribution
            if (job.result?.content) {
              job.result.content = processHtml(job.result.content, [
                removeImgDescriptions,
                wrapCitations,
                processParagraphs,
                convertMathToHtml,
                ($) => addPageAttributes($, chunks),
              ])
            }
            if (job.htmlContent) {
              job.htmlContent = processHtml(job.htmlContent, [
                removeImgDescriptions,
                wrapCitations,
                processParagraphs,
                convertMathToHtml,
                ($) => addPageAttributes($, chunks),
              ])
            }

            // Save results to S3 at document path
            if (job.result?.formats && fileInfo?.documentPath) {
              const docPath = fileInfo.documentPath

              // Save HTML and markdown to S3
              const saveResult = await tryCatch(Promise.all([
                storage.saveFile(`${docPath}/content.html`, job.result.formats.html),
                storage.saveFile(`${docPath}/content.md`, job.result.formats.markdown),
              ]))
              if (!saveResult.success) {
                console.error(`[jobs] Failed to save results: ${saveResult.error}`)
              }

              resultCache.set(jobId, {
                html: job.result.formats.html,
                markdown: job.result.formats.markdown,
                chunks,
                metadata: {
                  pages: (job.result.metadata as { pages?: number })?.pages,
                },
                filename: fileInfo.filename,
                fileId: fileInfo.fileId,
                documentPath: docPath,
              })
            }

            // For backends that don't support html_ready (like datalab), use result content
            const earlyContent = job.htmlContent || job.result?.content
            if (!htmlReadySent && earlyContent) {
              sendEvent("html_ready", { content: earlyContent })
              htmlReadySent = true
            }

            // Send completed event with fileId for downloads
            sendEvent("completed", {
              ...job.result,
              ...(imageUrls && { images: imageUrls }),
              jobId,
              fileId: fileInfo?.fileId,
            })
            finalStatus = "completed"
            jobFileMap.delete(jobId)
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
              // No chunks available yet, just do basic enhancements
              if (job.htmlContent) {
                job.htmlContent = processHtml(job.htmlContent, [
                  removeImgDescriptions,
                  wrapCitations,
                  processParagraphs,
                  convertMathToHtml,
                ])
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
})

// Cancel a running job
jobs.post("/jobs/:jobId/cancel", async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const backendType = process.env.BACKEND_MODE || "local"

  event.jobId = jobId
  event.backend = backendType as BackendType

  const backendResult = await tryCatch(async () => createBackend())
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    return c.json({ error: "Failed to initialize backend" }, 500)
  }
  const backend = backendResult.data

  if (!backend.supportsCancellation()) {
    return c.json({ error: "Backend does not support cancellation" }, 400)
  }

  const cancelResult = await tryCatch(backend.cancelJob!(jobId))
  if (!cancelResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(cancelResult.error),
      code: "CANCEL_ERROR",
    }
    return c.json({ error: "Failed to cancel job" }, 500)
  }

  // Cleanup S3 file
  handleCleanup(event, jobId, "cancelled")

  return c.json({ status: "cancelled", jobId })
})
