import type {
  TTSBackend,
  TTSSynthesizeInput,
  TTSSynthesizeResult,
  VoiceInfo,
} from "./interface"

// Longer timeout for TTS synthesis (up to 3 minutes for long text)
const TIMEOUT_MS = 180_000

interface RunpodTTSConfig {
  endpointId: string
  apiKey: string
}

/**
 * Runpod TTS backend - calls Runpod serverless TTS endpoint.
 * Uses /runsync for synchronous execution (TTS is fast enough).
 */
export class RunpodTTSBackend implements TTSBackend {
  readonly name = "runpod-tts"
  private config: RunpodTTSConfig
  private baseUrl: string

  constructor(config: RunpodTTSConfig) {
    this.config = config
    this.baseUrl = `https://api.runpod.ai/v2/${config.endpointId}`
  }

  async synthesize(input: TTSSynthesizeInput): Promise<TTSSynthesizeResult> {
    const response = await fetch(`${this.baseUrl}/runsync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          operation: "synthesize",
          text: input.text,
          voiceId: input.voiceId,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `Runpod TTS synthesis failed (${response.status}): ${error}`,
      )
    }

    const data = (await response.json()) as {
      status: string
      output?: {
        audio?: string
        sampleRate?: number
        durationMs?: number
        error?: string
      }
      error?: string
    }

    if (data.status !== "COMPLETED") {
      throw new Error(`Runpod TTS job failed: ${data.error || data.status}`)
    }

    if (data.output?.error) {
      throw new Error(`TTS synthesis error: ${data.output.error}`)
    }

    if (!data.output?.audio) {
      throw new Error("Runpod TTS returned no audio data")
    }

    return {
      audio: data.output.audio,
      sampleRate: data.output.sampleRate!,
      durationMs: data.output.durationMs!,
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/runsync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          operation: "listVoices",
        },
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Runpod listVoices failed (${response.status}): ${error}`)
    }

    const data = (await response.json()) as {
      status: string
      output?: {
        voices?: VoiceInfo[]
        error?: string
      }
      error?: string
    }

    if (data.status !== "COMPLETED" || data.output?.error) {
      throw new Error(
        `Runpod listVoices failed: ${data.output?.error || data.error}`,
      )
    }

    return data.output?.voices || []
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Use /health endpoint on Runpod to check endpoint status
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      })

      // Consider healthy if endpoint responds (even if no workers ready)
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Create Runpod TTS backend from environment.
 */
export function createRunpodTTSBackend(env: {
  RUNPOD_TTS_ENDPOINT_ID?: string
  RUNPOD_API_KEY?: string
}): RunpodTTSBackend {
  if (!env.RUNPOD_TTS_ENDPOINT_ID || !env.RUNPOD_API_KEY) {
    throw new Error(
      "Runpod TTS backend requires RUNPOD_TTS_ENDPOINT_ID and RUNPOD_API_KEY",
    )
  }

  return new RunpodTTSBackend({
    endpointId: env.RUNPOD_TTS_ENDPOINT_ID,
    apiKey: env.RUNPOD_API_KEY,
  })
}
