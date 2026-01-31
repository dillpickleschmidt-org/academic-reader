export interface VoiceInfo {
  id: string
  displayName: string
}

export interface TTSBackend {
  readonly name: string

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
