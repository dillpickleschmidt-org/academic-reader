import { Context, Effect, Layer } from "effect"
import { BackendError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../../config"

export type TTSEngine = "qwen3" | "kokoro"

export interface VoiceCapabilities {
  perBlock: boolean
  fullDocument: boolean
}

export interface VoiceDefinition {
  id: string
  displayName: string
  engine: TTSEngine
  capabilities: VoiceCapabilities
}

export interface SynthesizeResult {
  audio: string
  sampleRate: number
  durationMs: number
  wordTimestamps: Array<{ word: string, startMs: number, endMs: number }>
}

export interface StreamChunk {
  type: "audio" | "timestamps"
  audio?: string
  sampleRate?: number
  durationMs?: number
  wordTimestamps?: Array<{ word: string, startMs: number, endMs: number }>
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
  wordTimestamps: Array<{ word: string, startMs: number, endMs: number }>
}

export interface TTSBackend {
  synthesize(text: string, voiceId: string): Promise<SynthesizeResult>
  synthesizeStream(text: string, voiceId: string): AsyncGenerator<StreamChunk>
  synthesizeBatch(blocks: BatchBlock[], voiceId: string): AsyncGenerator<BatchResult>
  listVoices(): Promise<Array<{ id: string, displayName: string }>>
  healthCheck(): Promise<boolean>
}

const VOICE_REGISTRY: Record<string, VoiceDefinition> = {
  male_1: {
    id: "male_1",
    displayName: "Male 1",
    engine: "qwen3",
    capabilities: { perBlock: true, fullDocument: true },
  },
  female_1: {
    id: "female_1",
    displayName: "Female 1",
    engine: "kokoro",
    capabilities: { perBlock: false, fullDocument: true },
  },
  female_2: {
    id: "female_2",
    displayName: "Female 2",
    engine: "kokoro",
    capabilities: { perBlock: false, fullDocument: true },
  },
}

export interface TtsServiceShape {
  createBackend(voiceId: string): Effect.Effect<TTSBackend, BackendError>
  listVoices(): Array<{ id: string, displayName: string, capabilities: VoiceCapabilities }>
  activateWorker(workerName: string): Effect.Effect<void, BackendError>
}

export class TtsService extends Context.Tag("TtsService")<TtsService, TtsServiceShape>() {
  static Live = Layer.effect(
    TtsService,
    Effect.gen(function* () {
      const config = yield* AppConfig

      function getEngineUrl(engine: TTSEngine): string | undefined {
        if (config.backendMode === "local") {
          return engine === "qwen3" ? config.ttsWorkers.qwen3Url : config.ttsWorkers.kokoroUrl
        }
        return engine === "qwen3" ? config.modal.qwen3TtsUrl : config.modal.kokoroTtsUrl
      }

      function createHttpBackend(baseUrl: string): TTSBackend {
        return {
          async synthesize(text, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok) throw new Error(`TTS synthesize failed: ${await response.text()}`)
            return (await response.json()) as SynthesizeResult
          },

          async *synthesizeStream(text, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize/stream`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok) throw new Error(`TTS stream failed: ${await response.text()}`)
            if (!response.body) throw new Error("No response body for TTS stream")

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
                  yield JSON.parse(line) as StreamChunk
                }
              }
            }
            if (buffer.trim()) {
              yield JSON.parse(buffer) as StreamChunk
            }
          },

          async *synthesizeBatch(blocks, voiceId) {
            const response = await fetch(`${baseUrl}/synthesize/batch`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ blocks, voice_id: voiceId }),
            })
            if (!response.ok) throw new Error(`TTS batch failed: ${await response.text()}`)
            if (!response.body) throw new Error("No response body for TTS batch")

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
                  yield JSON.parse(line) as BatchResult
                }
              }
            }
            if (buffer.trim()) {
              yield JSON.parse(buffer) as BatchResult
            }
          },

          async listVoices() {
            const response = await fetch(`${baseUrl}/voices`)
            if (!response.ok) return []
            return (await response.json()) as Array<{ id: string, displayName: string }>
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
            const voice = VOICE_REGISTRY[voiceId]
            if (!voice) {
              return yield* new BackendError({
                message: `Unknown voice: ${voiceId}. Available: ${Object.keys(VOICE_REGISTRY).join(", ")}`,
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

        listVoices: () => {
          const voices = Object.values(VOICE_REGISTRY)
          const available = voices.filter((voice) => {
            if (config.backendMode === "local") return true
            return Boolean(getEngineUrl(voice.engine))
          })
          return available.map((v) => ({
            id: v.id,
            displayName: v.displayName,
            capabilities: v.capabilities,
          }))
        },

        activateWorker: (workerName) =>
          Effect.tryPromise({
            try: async () => {
              const url =
                workerName === "qwen3" ? config.ttsWorkers.qwen3Url : config.ttsWorkers.kokoroUrl
              await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) })
            },
            catch: (e) =>
              new BackendError({
                message: `Failed to activate ${workerName}: ${e instanceof Error ? e.message : String(e)}`,
                backend: "tts",
              }),
          }),
      }
    }),
  )
}
