import { Context, Effect, Layer } from "effect"
import { BackendError } from "@academic-reader/api-client/errors"
import {
  getVoice,
  type TTSEngine,
  type WordTimestamp,
} from "@academic-reader/api-client/schemas/tts"
import { AppConfig } from "../../config"

export type { TTSEngine }

export interface SynthesizedSpeech {
  audio: Uint8Array
  wordTimestamps: WordTimestamp[]
}

export interface TTSBackend {
  synthesize(text: string): Promise<SynthesizedSpeech>
}

export interface TtsServiceShape {
  createBackend(voiceId: string): Effect.Effect<TTSBackend, BackendError>
  activateWorker(engine: TTSEngine): Effect.Effect<void, BackendError>
  unloadWorker(engine: TTSEngine): Effect.Effect<void, BackendError>
}

type WorkerStreamChunk =
  | { type: "audio"; data: string }
  | { type: "timestamps"; wordTimestamps: WordTimestamp[] }

export class TtsService extends Context.Tag("TtsService")<
  TtsService,
  TtsServiceShape
>() {
  static Live = Layer.effect(
    TtsService,
    Effect.gen(function* () {
      const config = yield* AppConfig

      function getEngineUrl(engine: TTSEngine): string | undefined {
        if (config.ttsBackend === "none") return undefined

        if (config.ttsBackend === "local") {
          return engine === "qwen3"
            ? config.ttsWorkers.qwen3Url
            : config.ttsWorkers.kokoroUrl
        }

        return engine === "qwen3"
          ? config.modal.qwen3TtsUrl
          : config.modal.kokoroTtsUrl
      }

      function createHttpBackend(baseUrl: string, voiceId: string): TTSBackend {
        return {
          async synthesize(text) {
            const response = await fetch(`${baseUrl}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok) {
              throw new Error(`TTS stream failed: ${await response.text()}`)
            }
            if (!response.body) {
              throw new Error("No response body for TTS stream")
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            const pcmChunks: Uint8Array[] = []
            let wordTimestamps: WordTimestamp[] = []
            let buffer = ""

            const parseLine = (line: string) => {
              const chunk = parseWorkerStreamChunk(line)
              if (!chunk) return

              if (chunk.type === "audio") {
                const data = Buffer.from(chunk.data, "base64")
                if (data.length > 0) pcmChunks.push(data)
                return
              }

              wordTimestamps = chunk.wordTimestamps
            }

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""
              for (const line of lines) {
                if (line.trim()) parseLine(line)
              }
            }
            if (buffer.trim()) parseLine(buffer)

            return { audio: concatenate(pcmChunks), wordTimestamps }
          },
        }
      }

      return {
        createBackend: (voiceId) =>
          Effect.gen(function* () {
            const voice = getVoice(voiceId)
            if (!voice) {
              return yield* new BackendError({
                message: `Unknown voice: ${voiceId}`,
                backend: "tts",
              })
            }

            const url = getEngineUrl(voice.engine)
            if (!url) {
              return yield* new BackendError({
                message: `TTS engine ${voice.engine} not configured for TTS backend ${config.ttsBackend}`,
                backend: "tts",
              })
            }

            return createHttpBackend(url, voiceId)
          }),

        activateWorker: (engine) =>
          Effect.tryPromise({
            try: async () => {
              const url = getEngineUrl(engine)
              if (!url) {
                throw new Error(`No URL configured for engine: ${engine}`)
              }
              const response = await fetch(`${url}/health`, {
                signal: AbortSignal.timeout(60000),
              })
              if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`)
              }
            },
            catch: (e) =>
              new BackendError({
                message: `Failed to activate ${engine}: ${
                  e instanceof Error ? e.message : String(e)
                }`,
                backend: "tts",
              }),
          }),

        unloadWorker: (engine) =>
          Effect.tryPromise({
            try: async () => {
              const url = getEngineUrl(engine)
              if (!url) {
                throw new Error(`No URL configured for engine: ${engine}`)
              }
              const response = await fetch(`${url}/unload`, { method: "POST" })
              if (!response.ok) {
                throw new Error(`Unload failed: ${response.status}`)
              }
            },
            catch: (e) =>
              new BackendError({
                message: `Failed to unload ${engine}: ${
                  e instanceof Error ? e.message : String(e)
                }`,
                backend: "tts",
              }),
          }),
      }
    }),
  )
}

function parseWorkerStreamChunk(line: string): WorkerStreamChunk | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    console.warn("[tts] Malformed stream JSON, skipping:", line.slice(0, 200))
    return null
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    console.warn("[tts] Invalid stream chunk, skipping:", line.slice(0, 200))
    return null
  }

  if (
    parsed.type === "audio" &&
    "data" in parsed &&
    typeof parsed.data === "string"
  ) {
    return { type: "audio", data: parsed.data }
  }

  if (
    parsed.type === "timestamps" &&
    "wordTimestamps" in parsed &&
    Array.isArray(parsed.wordTimestamps)
  ) {
    const wordTimestamps = parsed.wordTimestamps.filter(isWordTimestamp)
    return { type: "timestamps", wordTimestamps }
  }

  console.warn("[tts] Unknown stream chunk, skipping:", line.slice(0, 200))
  return null
}

function isWordTimestamp(value: unknown): value is WordTimestamp {
  return (
    !!value &&
    typeof value === "object" &&
    "word" in value &&
    typeof value.word === "string" &&
    "startMs" in value &&
    typeof value.startMs === "number" &&
    "endMs" in value &&
    typeof value.endMs === "number"
  )
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const audio = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    audio.set(chunk, offset)
    offset += chunk.length
  }
  return audio
}
