import type {
  TTSBackend,
  BatchSegmentInput,
  BatchSegmentResult,
  VoiceInfo,
} from "./interface"

const TIMEOUT_MS = 180_000

interface LocalTTSConfig {
  baseUrl: string
}

/**
 * Local TTS backend - passes through to FastAPI TTS worker running locally.
 * Used for development when running docker compose.
 * Calls /synthesize sequentially for each segment (no cold start concern locally).
 */
export class LocalTTSBackend implements TTSBackend {
  readonly name = "local-tts"
  private baseUrl: string

  constructor(config: LocalTTSConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
  }

  async *synthesizeBatch(
    segments: BatchSegmentInput[],
    voiceId: string,
  ): AsyncGenerator<BatchSegmentResult> {
    for (const seg of segments) {
      if (!seg.text.trim()) {
        yield { segmentIndex: seg.index, error: "Empty text" }
        continue
      }

      try {
        const response = await fetch(`${this.baseUrl}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: seg.text, voiceId }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        if (!response.ok) {
          const error = await response.text()
          yield { segmentIndex: seg.index, error: `Synthesis failed: ${error}` }
          continue
        }

        const data = (await response.json()) as {
          audio: string
          sampleRate: number
          durationMs: number
        }

        yield {
          segmentIndex: seg.index,
          audio: data.audio,
          sampleRate: data.sampleRate,
          durationMs: data.durationMs,
        }
      } catch (e) {
        yield {
          segmentIndex: seg.index,
          error: e instanceof Error ? e.message : "Synthesis failed",
        }
      }
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
