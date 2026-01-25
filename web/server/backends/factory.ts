import type { ConversionBackend } from "./interface"
import { createLocalBackend } from "./local"
import { createRunpodBackend } from "./runpod"
import { createDatalabBackend } from "./datalab"
import { env } from "../env"

/**
 * Create the appropriate backend based on environment configuration.
 */
export function createBackend(): ConversionBackend {
  switch (env.BACKEND_MODE) {
    case "local":
      return createLocalBackend({
        LOCAL_WORKER_URL: env.LOCAL_WORKER_URL,
        LIGHTONOCR_WORKER_URL: env.LIGHTONOCR_WORKER_URL,
      })

    case "runpod":
      return createRunpodBackend({
        RUNPOD_MARKER_ENDPOINT_ID: env.RUNPOD_MARKER_ENDPOINT_ID,
        RUNPOD_LIGHTONOCR_ENDPOINT_ID: env.RUNPOD_LIGHTONOCR_ENDPOINT_ID,
        RUNPOD_API_KEY: env.RUNPOD_API_KEY,
      })

    case "datalab":
      return createDatalabBackend({
        DATALAB_API_KEY: env.DATALAB_API_KEY,
      })
  }
}
