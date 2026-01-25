import type { TTSBackend } from "./interface"
import { createLocalTTSBackend } from "./local"
import { createRunpodTTSBackend } from "./runpod"
import { getVoice, getEngineConfig } from "./registry"
import { env } from "../../env"

/**
 * Create TTS backend for a specific voice.
 * Routes to the appropriate engine based on VOICE_REGISTRY.
 */
export function createTTSBackend(voiceId: string): TTSBackend {
  const voice = getVoice(voiceId)
  const engineConfig = getEngineConfig(voiceId)

  switch (env.BACKEND_MODE) {
    case "local": {
      return createLocalTTSBackend({
        TTS_WORKER_URL: engineConfig.getLocalUrl(),
      })
    }

    case "runpod":
    case "datalab": {
      // Both runpod and datalab modes use Runpod for TTS
      // (Datalab doesn't provide TTS, so we use our Runpod TTS endpoint)
      const endpointId = engineConfig.getRunpodEndpointId()
      if (!endpointId) {
        throw new Error(
          `No RunPod endpoint configured for ${voice.engine} TTS engine.`,
        )
      }
      return createRunpodTTSBackend({
        endpointId,
        apiKey: env.RUNPOD_API_KEY,
      })
    }
  }
}
