import { Effect } from "effect"
import type {
  ConversionBackendService,
  ConversionJob,
} from "../services/backends/conversion"
import type { DocumentTaskWriter } from "./document-task-writer"

interface ConversionWaitOptions {
  backend: ConversionBackendService
  taskWriter: DocumentTaskWriter
  conversionTaskId: string
}

const POLLING_INTERVAL_MS = 1000
const MAX_POLLS = 1200

export function waitForConversion(
  options: ConversionWaitOptions,
  backendJobId: string,
): Effect.Effect<ConversionJob, Error> {
  return Effect.gen(function* () {
    let lastProgressKey = ""

    for (let i = 0; i < MAX_POLLS; i++) {
      const job = yield* options.backend.getJobStatus(backendJobId)

      if (job.progress) {
        const nextProgress = {
          label: job.progress.stage,
          current: job.progress.current,
          total: job.progress.total,
        }
        const key = `${nextProgress.label}:${nextProgress.current}:${nextProgress.total}`
        if (key !== lastProgressKey) {
          lastProgressKey = key
          yield* Effect.tryPromise({
            try: () =>
              options.taskWriter.setProgress(
                options.conversionTaskId,
                nextProgress,
              ),
            catch: toError,
          })
        }
      }

      if (job.status === "completed") return job

      if (job.status === "failed") {
        return yield* Effect.fail(new Error(job.error || "Conversion failed"))
      }

      yield* Effect.sleep(POLLING_INTERVAL_MS)
    }

    return yield* Effect.fail(new Error("Conversion timed out"))
  })
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
