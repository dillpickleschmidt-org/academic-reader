import type { TTSBackend, VoiceInfo } from "./interface"

interface LocalTTSConfig {
  baseUrl: string
}

export class LocalTTSBackend implements TTSBackend {
  readonly name = "local-tts"
  private baseUrl: string

  constructor(config: LocalTTSConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
  }

  async *synthesizeStream(text: string, voiceId: string): AsyncGenerator<Uint8Array> {
    if (!text.trim()) {
      throw new Error("Empty text")
    }

    const res = await fetch(`${this.baseUrl}/synthesize/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: voiceId }),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Stream failed: ${error}`)
    }

    if (!res.body) {
      throw new Error("No response body")
    }

    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield value
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

export function createLocalTTSBackend(env: {
  TTS_WORKER_URL?: string
}): LocalTTSBackend {
  return new LocalTTSBackend({
    baseUrl: env.TTS_WORKER_URL || "http://localhost:8001",
  })
}
