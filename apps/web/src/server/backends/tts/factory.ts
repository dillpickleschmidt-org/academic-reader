import type { TTSBackend } from "./interface"
import type { BackendType } from "../../types"
import { createLocalTTSBackend } from "./local"

/**
 * Create the appropriate TTS backend based on environment configuration.
 *
 * Uses existing BACKEND_MODE to determine which backend to use:
 * - "local" -> Local TTS worker container
 * - "runpod" or "datalab" -> RunPod TTS endpoint (future)
 */
export function createTTSBackend(): TTSBackend {
  const backendType = (process.env.BACKEND_MODE as BackendType) || "local"

  switch (backendType) {
    case "local":
      return createLocalTTSBackend({
        TTS_WORKER_URL: process.env.TTS_WORKER_URL,
      })

    case "runpod":
    case "datalab":
      // Future: Add RunPod TTS backend
      // For now, throw an error since it's not implemented
      throw new Error(
        `TTS backend for ${backendType} is not yet implemented. ` +
          `Set BACKEND_MODE=local to use local TTS worker.`,
      )

    default:
      throw new Error(`Unknown backend type: ${backendType}`)
  }
}
