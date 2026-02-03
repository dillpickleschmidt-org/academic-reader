export interface VoiceInfo {
  id: string
  displayName: string
}

export interface SynthesizeResult {
  audio: string // base64-encoded WAV
  sampleRate: number
  durationMs: number
}

export interface TTSBackend {
  readonly name: string

  /**
   * Synthesize audio and return complete result (non-streaming).
   */
  synthesize(text: string, voiceId: string): Promise<SynthesizeResult>

  /**
   * Stream audio chunks as raw PCM s16le at 24kHz.
   */
  synthesizeStream(text: string, voiceId: string): AsyncGenerator<Uint8Array>

  /**
   * List available voices.
   */
  listVoices(): Promise<VoiceInfo[]>

  /**
   * Check if the backend is healthy/reachable.
   */
  healthCheck(): Promise<boolean>
}
