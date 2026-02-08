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

async function* readNdjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
      if (line.trim()) yield line
    }
  }

  if (buffer.trim()) yield buffer
}

export async function* parseStreamingNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  for await (const line of readNdjsonLines(body)) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === "audio") {
        yield { type: "audio", data: Buffer.from(parsed.data, "base64") }
      } else if (parsed.type === "timestamps") {
        yield { type: "timestamps", wordTimestamps: parsed.wordTimestamps }
      }
    } catch (e) {
      console.warn("[tts-stream] Malformed NDJSON line, skipping:", e)
    }
  }
}

export interface BatchBlock {
  blockId: string
  text: string
  voiceId: string
}

export interface BatchResult {
  blockId: string
  audio: string
  sampleRate: number
  durationMs: number
  wordTimestamps: WordTimestamp[]
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
   * Process multiple blocks in a single request, yielding results as they complete.
   */
  synthesizeBatch(blocks: BatchBlock[]): AsyncGenerator<BatchResult>

  /**
   * List available voices.
   */
  listVoices(): Promise<VoiceInfo[]>

  /**
   * Check if the backend is healthy/reachable.
   */
  healthCheck(): Promise<boolean>
}

export async function* parseBatchNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<BatchResult> {
  for await (const line of readNdjsonLines(body)) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.error) {
        console.warn(`[tts-batch] Block ${parsed.blockId} failed: ${parsed.error}`)
        continue
      }
      yield parsed as BatchResult
    } catch (e) {
      console.warn("[tts-batch] Malformed NDJSON line, skipping:", e)
    }
  }
}
