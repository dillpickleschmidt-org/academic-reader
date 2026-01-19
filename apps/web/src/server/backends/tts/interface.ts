/**
 * Interface for TTS backends with batch streaming support.
 */

export interface BatchSegmentInput {
  index: number
  text: string
}

export interface BatchSegmentResult {
  segmentIndex: number
  audio?: string // Base64 encoded WAV
  sampleRate?: number
  durationMs?: number
  error?: string // Set if this segment failed
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
   * Synthesize multiple segments in a batch.
   * Yields results as each segment completes (streaming).
   */
  synthesizeBatch(
    segments: BatchSegmentInput[],
    voiceId: string,
  ): AsyncGenerator<BatchSegmentResult>

  /**
   * List available voices.
   */
  listVoices(): Promise<VoiceInfo[]>

  /**
   * Check if the backend is healthy/reachable.
   */
  healthCheck(): Promise<boolean>
}
