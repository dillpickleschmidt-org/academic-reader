import type {
  TTSBackend,
  TTSSynthesizeInput,
  TTSSynthesizeResult,
  VoiceInfo,
} from "./interface"

const TIMEOUT_MS = 180_000

interface LocalTTSConfig {
  baseUrl: string
}

/**
 * Local TTS backend - passes through to FastAPI TTS worker running locally.
 * Used for development when running docker compose.
 */
export class LocalTTSBackend implements TTSBackend {
  readonly name = "local-tts"
  private baseUrl: string

  constructor(config: LocalTTSConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
  }

  async synthesize(input: TTSSynthesizeInput): Promise<TTSSynthesizeResult> {
    const response = await fetch(`${this.baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        voiceId: input.voiceId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`TTS synthesis failed: ${error}`)
    }

    const data = (await response.json()) as {
      audio: string
      sampleRate: number
      durationMs: number
    }

    return {
      audio: data.audio,
      sampleRate: data.sampleRate,
      durationMs: data.durationMs,
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to list voices: ${response.statusText}`)
    }

    return (await response.json()) as VoiceInfo[]
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Create Local TTS backend from environment.
 */
export function createLocalTTSBackend(env: {
  TTS_WORKER_URL?: string
}): LocalTTSBackend {
  return new LocalTTSBackend({
    baseUrl: env.TTS_WORKER_URL || "http://localhost:8001",
  })
}
