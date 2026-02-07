import { env } from "../../env"

export type TTSEngine = "qwen3" | "kokoro"

export interface VoiceDefinition {
  id: string
  displayName: string
  engine: TTSEngine
}

export interface EngineConfig {
  getLocalUrl: () => string
  getModalUrl: () => string | undefined
}

export const VOICE_REGISTRY: Record<string, VoiceDefinition> = {
  male_1: {
    id: "male_1",
    displayName: "Male 1",
    engine: "qwen3",
  },
  female_1: {
    id: "female_1",
    displayName: "Female 1",
    engine: "kokoro",
  },
  female_2: {
    id: "female_2",
    displayName: "Female 2",
    engine: "kokoro",
  },
}

export const ENGINE_REGISTRY: Record<TTSEngine, EngineConfig> = {
  qwen3: {
    getLocalUrl: () => env.QWEN3_TTS_WORKER_URL,
    getModalUrl: () => env.MODAL_QWEN3_TTS_URL,
  },
  kokoro: {
    getLocalUrl: () => env.KOKORO_TTS_WORKER_URL,
    getModalUrl: () => env.MODAL_KOKORO_TTS_URL,
  },
}

export function getVoice(voiceId: string): VoiceDefinition {
  const voice = VOICE_REGISTRY[voiceId]
  if (!voice) {
    throw new Error(
      `Unknown voice: ${voiceId}. Available: ${Object.keys(VOICE_REGISTRY).join(", ")}`,
    )
  }
  return voice
}

export function getEngineForVoice(voiceId: string): TTSEngine {
  return getVoice(voiceId).engine
}

export function getEngineConfig(voiceId: string): EngineConfig {
  return ENGINE_REGISTRY[getEngineForVoice(voiceId)]
}

export function listVoices(): VoiceDefinition[] {
  return Object.values(VOICE_REGISTRY)
}

export function listAvailableVoices(): VoiceDefinition[] {
  return listVoices().filter((voice) => {
    if (env.BACKEND_MODE === "local") {
      return true
    }

    const engineConfig = ENGINE_REGISTRY[voice.engine]
    return Boolean(engineConfig.getModalUrl())
  })
}

export function listAvailableVoiceSummaries(): Array<{
  id: string
  displayName: string
}> {
  return listAvailableVoices().map((voice) => ({
    id: voice.id,
    displayName: voice.displayName,
  }))
}
