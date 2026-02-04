import type { TTSBackend, VoiceInfo, SynthesizeResult, StreamChunk } from "./interface"
import { parseNdjsonStream } from "./interface"

interface ModalTTSConfig {
  qwen3Url?: string
}

export class ModalTTSBackend implements TTSBackend {
  readonly name = "modal-tts"
  private config: ModalTTSConfig

  constructor(config: ModalTTSConfig) {
    this.config = config
  }

  async synthesize(text: string, voiceId: string): Promise<SynthesizeResult> {
    if (!text.trim()) {
      throw new Error("Empty text")
    }

    if (!this.config.qwen3Url) {
      throw new Error("No endpoint configured for TTS")
    }

    const res = await fetch(`${this.config.qwen3Url}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId }),
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Synthesis failed: ${error}`)
    }

    return res.json() as Promise<SynthesizeResult>
  }

  async *synthesizeStream(text: string, voiceId: string): AsyncGenerator<StreamChunk> {
    if (!text.trim()) {
      throw new Error("Empty text")
    }

    if (!this.config.qwen3Url) {
      throw new Error("No endpoint configured for TTS")
    }

    const res = await fetch(`${this.config.qwen3Url}/synthesize/stream`, {
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

    yield* parseNdjsonStream(res.body)
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.config.qwen3Url) return []

    try {
      const res = await fetch(`${this.config.qwen3Url}/voices`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = (await res.json()) as { voices: VoiceInfo[] }
        return data.voices
      }
    } catch {
      // Ignore errors
    }

    return []
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.qwen3Url) return false

    try {
      const res = await fetch(`${this.config.qwen3Url}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

export function createModalTTSBackend(env: {
  MODAL_QWEN3_TTS_URL?: string
}): ModalTTSBackend {
  return new ModalTTSBackend({
    qwen3Url: env.MODAL_QWEN3_TTS_URL,
  })
}
