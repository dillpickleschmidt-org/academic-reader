import { Context, Effect, Layer } from "effect"
import { BackendError } from "@academic-reader/api-client/errors"
import { VOICES, type TTSEngine } from "@academic-reader/api-client/schemas/tts"
import { AppConfig } from "../../config"

export type { TTSEngine }

export interface SynthesizeResult {
  audio: string
  sampleRate: number
  durationMs: number
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>
}

export interface StreamChunk {
  type: "audio" | "timestamps"
  audio?: string
  sampleRate?: number
  durationMs?: number
  wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>
}

export interface BatchBlock {
  blockId: string
  text: string
}

export interface BatchResult {
  blockId: string
  audio: string
  sampleRate: number
  durationMs: number
  wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>
}

export interface TTSBackend {
  synthesize(text: string, voiceId: string): Promise<SynthesizeResult>
  synthesizeStream(text: string, voiceId: string): AsyncGenerator<StreamChunk>
  synthesizeBatch(
    blocks: BatchBlock[],
    voiceId: string,
  ): AsyncGenerator<BatchResult>
  healthCheck(): Promise<boolean>
}


export interface TtsServiceShape {
  createBackend(voiceId: string): Effect.Effect<TTSBackend, BackendError>
  activateWorker(workerName: string): Effect.Effect<void, BackendError>
}

export class TtsService extends Context.Tag("TtsService")<
  TtsService,
  TtsServiceShape
>() {
  static Live = Layer.effect(
    TtsService,
    Effect.gen(function* () {
      const config = yield* AppConfig

      function getEngineUrl(engine: TTSEngine): string | undefined {
        if (config.backendMode === "local") {
          return engine === "qwen3"
            ? config.ttsWorkers.qwen3Url
            : config.ttsWorkers.kokoroUrl
        }
        return engine === "qwen3"
          ? config.modal.qwen3TtsUrl
          : config.modal.kokoroTtsUrl
      }

      function tryParseJSON<T>(line: string, label: string): T | null {
        try {
          return JSON.parse(line) as T
        } catch {
          console.warn(
            `[tts] Malformed ${label} JSON, skipping:`,
            line.slice(0, 200),
          )
          return null
        }
      }

      function createHttpBackend(baseUrl: string): TTSBackend {
        return {
          async synthesize(text, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok)
              throw new Error(`TTS synthesize failed: ${await response.text()}`)
            return (await response.json()) as SynthesizeResult
          },

          async *synthesizeStream(text, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize/stream`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok)
              throw new Error(`TTS stream failed: ${await response.text()}`)
            if (!response.body)
              throw new Error("No response body for TTS stream")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""
              for (const line of lines) {
                if (line.trim()) {
                  const parsed = tryParseJSON<StreamChunk>(line, "stream")
                  if (parsed) yield parsed
                }
              }
            }
            if (buffer.trim()) {
              const parsed = tryParseJSON<StreamChunk>(buffer, "stream")
              if (parsed) yield parsed
            }
          },

          async *synthesizeBatch(blocks, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize/batch`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ blocks, voice_id: voiceId }),
            })
            if (!response.ok)
              throw new Error(`TTS batch failed: ${await response.text()}`)
            if (!response.body)
              throw new Error("No response body for TTS batch")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""
              for (const line of lines) {
                if (line.trim()) {
                  const parsed = tryParseJSON<BatchResult>(line, "batch")
                  if (parsed) yield parsed
                }
              }
            }
            if (buffer.trim()) {
              const parsed = tryParseJSON<BatchResult>(buffer, "batch")
              if (parsed) yield parsed
            }
          },

          async healthCheck() {
            try {
              const response = await fetch(`${baseUrl}/health`, {
                signal: AbortSignal.timeout(5000),
              })
              return response.ok
            } catch {
              return false
            }
          },
        }
      }

      return {
        createBackend: (voiceId) =>
          Effect.gen(function* () {
            const voice = VOICES.find((v) => v.id === voiceId)
            if (!voice) {
              return yield* new BackendError({
                message: `Unknown voice: ${voiceId}. Available: ${VOICES.map((v) => v.id).join(", ")}`,
                backend: "tts",
              })
            }

            const url = getEngineUrl(voice.engine)
            if (!url) {
              return yield* new BackendError({
                message: `TTS engine ${voice.engine} not configured for backend mode ${config.backendMode}`,
                backend: "tts",
              })
            }

            return createHttpBackend(url)
          }),

        activateWorker: (engine) =>
          Effect.tryPromise({
            try: async () => {
              const url = getEngineUrl(engine as TTSEngine)
              if (!url) throw new Error(`No URL configured for engine: ${engine}`)
              await fetch(`${url}/health`, {
                signal: AbortSignal.timeout(60000),
              })
            },
            catch: (e) =>
              new BackendError({
                message: `Failed to activate ${engine}: ${e instanceof Error ? e.message : String(e)}`,
                backend: "tts",
              }),
          }),
      }
    }),
  )
}
