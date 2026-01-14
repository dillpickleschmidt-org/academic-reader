import type { ConversionBackend } from "./interface"
import type { BackendType } from "../types"
import { createLocalBackend } from "./local"
import { createRunpodBackend } from "./runpod"
import { createDatalabBackend } from "./datalab"

/**
 * Create the appropriate backend based on environment configuration.
 */
export function createBackend(): ConversionBackend {
  const backendType = (process.env.BACKEND_MODE as BackendType) || "local"

  switch (backendType) {
    case "local":
      return createLocalBackend({
        LOCAL_WORKER_URL: process.env.LOCAL_WORKER_URL,
      })

    case "runpod":
      return createRunpodBackend({
        RUNPOD_ENDPOINT_ID: process.env.RUNPOD_ENDPOINT_ID,
        RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
      })

    case "datalab":
      return createDatalabBackend({
        DATALAB_API_KEY: process.env.DATALAB_API_KEY,
      })

    default:
      throw new Error(`Unknown backend type: ${backendType}`)
  }
}
