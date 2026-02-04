export interface VoiceInfo {
  id: string
  displayName: string
}

export interface SynthesizeResult {
  audio: string // base64-encoded WAV
  sampleRate: number
  durationMs: number
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>
}

export type WordTimestamp = { word: string; startMs: number; endMs: number }

export type StreamChunk =
  | { type: "audio"; data: Uint8Array }
  | { type: "timestamps"; wordTimestamps: WordTimestamp[] }

function parseNdjsonLine(line: string): StreamChunk | null {
  const parsed = JSON.parse(line)
  if (parsed.type === "audio") {
    return { type: "audio", data: Buffer.from(parsed.data, "base64") }
  } else if (parsed.type === "timestamps") {
    return { type: "timestamps", wordTimestamps: parsed.wordTimestamps }
  }
  return null
}

export async function* parseNdjsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = parseNdjsonLine(line)
      if (chunk) yield chunk
    }
  }

  if (buffer.trim()) {
    const chunk = parseNdjsonLine(buffer)
    if (chunk) yield chunk
  }
}

export interface TTSBackend {
  readonly name: string

  /**
   * Synthesize audio and return complete result (non-streaming).
   */
  synthesize(text: string, voiceId: string): Promise<SynthesizeResult>

  /**
   * Stream audio chunks and word timestamps as NDJSON.
   */
  synthesizeStream(text: string, voiceId: string): AsyncGenerator<StreamChunk>

  /**
   * List available voices.
   */
  listVoices(): Promise<VoiceInfo[]>

  /**
   * Check if the backend is healthy/reachable.
   */
  healthCheck(): Promise<boolean>
}
