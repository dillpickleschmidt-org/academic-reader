import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { requireAuth } from "../middleware/auth"
import { enrichEvent, getEvent } from "../middleware/wide-event"
import { ConversionBackend } from "../services/backends/conversion"
import { JobFileMap } from "../services/job-file-map"
import { handleStreamingJob } from "../processing/stream-proxy"
import { handlePollingJob } from "../processing/poll-emitter"

export const jobsRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/:jobId/stream", Effect.gen(function* () {
    const { userId } = yield* requireAuth
    const request = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const jobId = params.jobId!
    const backend = yield* ConversionBackend
    const jobFileMap = yield* JobFileMap

    yield* enrichEvent({ jobId } as Record<string, unknown>)

    const fileInfo = yield* jobFileMap.get(jobId)

    const cookies = request.cookies
    const requestCookies = cookies as Record<string, string>

    const event = yield* getEvent

    if (backend.supportsStreaming() && backend.name === "local") {
      const streamUrl = backend.getStreamUrl(jobId)
      if (streamUrl) {
        return yield* handleStreamingJob(jobId, streamUrl, event, fileInfo, requestCookies)
      }
    }

    const webRequest = yield* HttpServerRequest.toWeb(request)
    return yield* handlePollingJob(jobId, event, fileInfo, webRequest.signal, requestCookies)
  })),

  HttpRouter.post("/:jobId/cancel", Effect.gen(function* () {
    yield* requireAuth
    const params = yield* HttpRouter.params
    const jobId = params.jobId!
    const backend = yield* ConversionBackend

    yield* enrichEvent({ jobId } as Record<string, unknown>)

    if (!backend.supportsCancellation()) {
      return HttpServerResponse.unsafeJson(
        { error: "Backend does not support cancellation" },
        { status: 400 },
      )
    }

    const cancelResult = yield* backend.cancelJob(jobId).pipe(Effect.either)

    if (cancelResult._tag === "Left" || !cancelResult.right) {
      return HttpServerResponse.unsafeJson(
        { error: "Failed to cancel job" },
        { status: 500 },
      )
    }

    return HttpServerResponse.unsafeJson({ status: "cancelled", jobId })
  })),
)
