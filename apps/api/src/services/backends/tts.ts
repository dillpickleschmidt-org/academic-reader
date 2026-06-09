import { Context, Effect, Layer } from "effect"
import { BackendError } from "@academic-reader/api-client/errors"
import {
  getVoice,
  type TTSEngine,
  type WordTimestamp,
} from "@academic-reader/api-client/schemas/tts"
import { AppConfig } from "../../config"

interface SynthesizedSpeech {
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

const TTS_ACTIVATION_TIMEOUT_MS = 300 * 1000
const QWEN3_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

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

      function createKokoroBackend(baseUrl: string, voiceId: string): TTSBackend {
        return {
          async synthesize(text) {
            const response = await fetch(`${baseUrl}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok) {
              throw new Error(`Kokoro TTS failed: ${await response.text()}`)
            }

            return parseKokoroResponse(await response.json())
          },
        }
      }

      function createQwen3Backend(baseUrl: string, voiceId: string): TTSBackend {
        return {
          async synthesize(text) {
            const response = await fetch(`${baseUrl}/v1/audio/speech`, {
              method: "POST",
              headers: {
                "Authorization": "Bearer EMPTY",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: QWEN3_MODEL,
                input: text,
                voice: voiceId,
                task_type: "Base",
                language: "English",
                response_format: "pcm",
                stream: true,
                max_new_tokens: 4096,
              }),
            })
            if (!response.ok) {
              throw new Error(`Qwen3 TTS failed: ${await response.text()}`)
            }
            if (response.headers.get("content-type")?.includes("application/json")) {
              throw new Error(`Qwen3 TTS failed: ${await response.text()}`)
            }
            if (!response.body) {
              throw new Error("No response body for Qwen3 TTS stream")
            }

            const reader = response.body.getReader()
            const pcmChunks: Uint8Array[] = []
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value.length > 0) pcmChunks.push(value)
            }

            return {
              audio: concatenate(pcmChunks),
              wordTimestamps: [],
            }
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

            return voice.engine === "qwen3"
              ? createQwen3Backend(url, voiceId)
              : createKokoroBackend(url, voiceId)
          }),

        activateWorker: (engine) =>
          Effect.tryPromise({
            try: async () => {
              const url = getEngineUrl(engine)
              if (!url) {
                throw new Error(`No URL configured for engine: ${engine}`)
              }
              const response = await fetch(`${url}/health`, {
                signal: AbortSignal.timeout(TTS_ACTIVATION_TIMEOUT_MS),
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

        unloadWorker: (engine) => {
          if (engine === "qwen3") return Effect.succeed(undefined)

          return Effect.tryPromise({
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
          })
        },
      }
    }),
  )
}

function parseKokoroResponse(value: unknown): SynthesizedSpeech {
  if (!value || typeof value !== "object" || !("audio" in value)) {
    throw new Error("Invalid Kokoro TTS response")
  }
  if (typeof value.audio !== "string") {
    throw new Error("Invalid Kokoro TTS audio response")
  }

  const wordTimestamps =
    "wordTimestamps" in value && Array.isArray(value.wordTimestamps)
      ? value.wordTimestamps.filter(isWordTimestamp)
      : []

  return {
    audio: Buffer.from(value.audio, "base64"),
    wordTimestamps,
  }
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
