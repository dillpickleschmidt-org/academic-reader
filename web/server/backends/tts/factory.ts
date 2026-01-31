import type { TTSBackend } from "./interface"
import { createLocalTTSBackend } from "./local"
import { createModalTTSBackend } from "./modal"
import { getEngineConfig } from "./registry"
import { env } from "../../env"

export function createTTSBackend(voiceId: string): TTSBackend {
  const engineConfig = getEngineConfig(voiceId)

  switch (env.BACKEND_MODE) {
    case "local": {
      return createLocalTTSBackend({
        TTS_WORKER_URL: engineConfig.getLocalUrl(),
      })
    }

    case "datalab":
    case "modal": {
      return createModalTTSBackend({
        MODAL_QWEN3_TTS_URL: env.MODAL_QWEN3_TTS_URL,
      })
    }
  }
}
