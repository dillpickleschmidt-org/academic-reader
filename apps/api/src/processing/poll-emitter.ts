import { Effect } from "effect"
import { HttpServerResponse } from "@effect/platform"
import type { WideEvent } from "../middleware/wide-event"
import { emitStreamingEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { AppConfig } from "../config"
import { ConversionBackend, type ConversionJob } from "../services/backends/conversion"
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"
import { processCompletedJob, SSE_HEADERS, type JobResultInput } from "./completed-job"
import { JobFileMap, type JobFileEntry } from "../services/job-file-map"

const POLLING = {
  MAX_POLLS: 1200,
  INTERVAL_MS: 1000,
} as const

type FinalStatus = "completed" | "failed" | "timeout" | "cancelled"

export function handlePollingJob(
  jobId: string,
  event: WideEvent,
  fileInfo: JobFileEntry | undefined,
  signal: AbortSignal,
  requestCookies: Record<string, string>,
) {
  return Effect.gen(function* () {
    const config = yield* AppConfig
    const storage = yield* Storage
    const backend = yield* ConversionBackend
    const jobFileMap = yield* JobFileMap
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
            encoder.encode(`event: ${sseEvent}\ndata: ${JSON.stringify(data)}\n\n`),
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
          if (Date.now() - lastEventTime > KEEPALIVE_INTERVAL_MS) {
            sendKeepalive()
          }

          if (signal.aborted) {
            finalStatus = "cancelled"
            completed = true
            if (backend.supportsCancellation()) {
              void Effect.runPromise(backend.cancelJob(jobId)).catch(() => {})
            }
            break
          }

          let job: ConversionJob
          try {
            job = await Effect.runPromise(backend.getJobStatus(jobId))
          } catch (err) {
            sendEvent("error", { message: "Failed to get job status" })
            finalStatus = "failed"
            event.error = {
              category: "backend",
              message: err instanceof Error ? err.message : String(err),
              code: "POLL_ERROR",
            }
            completed = true
            break
          }

          if (job.progress) {
            const key = `${job.progress.stage}:${job.progress.current}:${job.progress.total}`
            if (key !== lastProgressKey) {
              sendEvent("progress", job.progress)
              lastProgressKey = key
            }
          }

          switch (job.status) {
            case "completed": {
              let resultData = job.result as JobResultInput | undefined

              if (job.s3Result && fileInfo?.documentPath) {
                const resultKey = `${fileInfo.documentPath}/result.json`
                try {
                  const resultJson = await Effect.runPromise(storage.readFileAsString(resultKey))
                  resultData = JSON.parse(resultJson)
                  await Effect.runPromise(storage.deleteFile(resultKey))
                } catch (err) {
                  sendEvent("error", { message: "Failed to fetch conversion result" })
                  finalStatus = "failed"
                  event.error = {
                    category: "storage",
                    message: err instanceof Error ? err.message : String(err),
                    code: "S3_FETCH_ERROR",
                  }
                  completed = true
                  break
                }
              }

              const resultToProcess = {
                ...resultData,
                content: resultData?.content || job.htmlContent,
              }

              try {
                const processedResult = await Effect.runPromise(
                  processCompletedJob(jobId, resultToProcess, fileInfo, event, requestCookies).pipe(
                    Effect.provideService(AppConfig, config),
                    Effect.provideService(Storage, storage as any),
                  ),
                )

                if (!htmlReadySent && processedResult.content) {
                  sendEvent("html_ready", { content: processedResult.content })
                  htmlReadySent = true
                }

                const resultForClient: any = { ...resultData }
                if (resultForClient?.formats?.markdown) {
                  const { markdown: _, ...formatsWithoutMarkdown } = resultForClient.formats
                  resultForClient.formats = formatsWithoutMarkdown
                }
                if (resultForClient?.formats?.chunks) {
                  resultForClient.formats.chunks.blocks = processedResult.blocks
                }

                sendEvent("completed", {
                  ...resultForClient,
                  content: processedResult.content,
                  ...(processedResult.imageUrls && { images: processedResult.imageUrls }),
                  ...(processedResult.documentId && { documentId: processedResult.documentId }),
                  jobId,
                  fileId: fileInfo?.fileId,
                })
                finalStatus = "completed"
              } catch (err) {
                sendEvent("error", { message: "Failed to process completed job" })
                finalStatus = "failed"
                event.error = {
                  category: "internal",
                  message: err instanceof Error ? err.message : String(err),
                  code: "PROCESS_ERROR",
                }
              }

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
              completed = true
              break
            }
            case "html_ready":
              if (!htmlReadySent && job.htmlContent) {
                const enhanced = processHtml(job.htmlContent, HTML_TRANSFORMS)
                sendEvent("html_ready", { content: enhanced })
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
          if (backend.supportsCancellation()) {
            void Effect.runPromise(backend.cancelJob(jobId)).catch(() => {})
          }
        }

        controller.close()

        emitStreamingEvent(event, {
          streamEvents: eventCount,
          durationMs: Math.round(performance.now() - streamStart),
          status: finalStatus === "completed" ? 200 : finalStatus === "cancelled" ? 499 : 500,
        })
      },
    })

    return HttpServerResponse.fromWeb(new Response(stream, { headers: SSE_HEADERS }))
  })
}
