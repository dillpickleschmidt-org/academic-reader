import type {
  TTSBackend,
  BatchSegmentInput,
  BatchSegmentResult,
  VoiceInfo,
} from "./interface"

const POLL_INTERVAL_MS = 500
const MAX_POLL_TIME_MS = 600_000 // 10 minutes

interface RunpodTTSConfig {
  endpointId: string
  apiKey: string
}

/**
 * Runpod TTS backend with batch streaming support.
 * Uses /run + /stream for generator-based streaming.
 */
export class RunpodTTSBackend implements TTSBackend {
  readonly name = "runpod-tts"
  private config: RunpodTTSConfig
  private baseUrl: string

  constructor(config: RunpodTTSConfig) {
    this.config = config
    this.baseUrl = `https://api.runpod.ai/v2/${config.endpointId}`
  }

  async *synthesizeBatch(
    segments: BatchSegmentInput[],
    voiceId: string,
  ): AsyncGenerator<BatchSegmentResult> {
    // Start job with /run (async, not /runsync)
    const runResponse = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          operation: "synthesizeBatch",
          segments: segments.map((s) => ({ index: s.index, text: s.text })),
          voiceId,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!runResponse.ok) {
      const error = await runResponse.text()
      throw new Error(
        `Runpod batch start failed (${runResponse.status}): ${error}`,
      )
    }

    const { id: jobId } = (await runResponse.json()) as { id: string }

    // Poll /stream/{jobId} for yielded results
    // Track seen indices since Runpod may clear stream after each read
    const startTime = Date.now()
    const seenIndices = new Set<number>()

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
      const streamResponse = await fetch(`${this.baseUrl}/stream/${jobId}`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      })

      if (!streamResponse.ok) {
        throw new Error(`Stream poll failed: ${await streamResponse.text()}`)
      }

      const data = (await streamResponse.json()) as {
        status: string
        stream?: Array<{ output: BatchSegmentResult }>
        error?: string
      }

      // Yield any new results
      if (data.stream) {
        for (const item of data.stream) {
          const result = item.output
          if (!seenIndices.has(result.segmentIndex)) {
            seenIndices.add(result.segmentIndex)
            yield result
          }
        }
      }

      // Check if job is done
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        if (data.error) {
          throw new Error(`Batch synthesis failed: ${data.error}`)
        }
        return
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    // If we exit the loop without returning, we timed out
    throw new Error(
      `Batch synthesis timed out after ${MAX_POLL_TIME_MS / 1000}s`,
    )
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${this.baseUrl}/runsync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { operation: "listVoices" },
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Runpod listVoices failed (${response.status}): ${error}`)
    }

    const data = (await response.json()) as {
      status: string
      output?: { voices?: VoiceInfo[]; error?: string }
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
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
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
