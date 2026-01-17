/**
 * Interface for TTS backends.
 * Simpler than ConversionBackend since TTS is synchronous.
 */

export interface TTSSynthesizeInput {
  text: string
  voiceId: string
}

export interface TTSSynthesizeResult {
  audio: string // Base64 encoded WAV
  sampleRate: number
  durationMs: number
}

export interface VoiceInfo {
  id: string
  displayName: string
}

export interface TTSBackend {
  /**
   * Backend identifier for logging/debugging
   */
  readonly name: string

  /**
   * Synthesize speech from text.
   * This is a synchronous operation (waits for audio to be generated).
   */
  synthesize(input: TTSSynthesizeInput): Promise<TTSSynthesizeResult>

  /**
   * List available voices.
   */
  listVoices(): Promise<VoiceInfo[]>

  /**
   * Check if the backend is healthy/reachable.
   */
  healthCheck(): Promise<boolean>
}
