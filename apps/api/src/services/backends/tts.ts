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
  timing: TtsWordTimingResult
}

export type TtsWordTimingSource = "native" | "forced_alignment"
export type TtsWordTimingStatus = "ok" | "unavailable" | "failed"

export interface TtsWordTimingResult {
  source: TtsWordTimingSource
  status: TtsWordTimingStatus
  error: string | null
  diagnostics: unknown | null
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

export class TtsService extends Context.Service<
  TtsService,
  TtsServiceShape
>()("TtsService") {
  static layer = Layer.effect(
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

      function createWorkerBackend(
        baseUrl: string,
        voiceId: string,
        engineName: string,
      ): TTSBackend {
        return {
          async synthesize(text) {
            const response = await fetch(`${baseUrl}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, voice_id: voiceId }),
            })
            if (!response.ok) {
              throw new Error(`${engineName} TTS failed: ${await response.text()}`)
            }

            return parseWorkerResponse(await response.json(), engineName)
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

            return createWorkerBackend(
              url,
              voiceId,
              voice.engine === "qwen3" ? "Qwen3" : "Kokoro",
            )
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

function parseWorkerResponse(
  value: unknown,
  engineName: string,
): SynthesizedSpeech {
  if (!value || typeof value !== "object" || !("audio" in value)) {
    throw new Error(`Invalid ${engineName} TTS response`)
  }
  if (typeof value.audio !== "string") {
    throw new Error(`Invalid ${engineName} TTS audio response`)
  }

  const wordTimestamps =
    "wordTimestamps" in value && Array.isArray(value.wordTimestamps)
      ? value.wordTimestamps.filter(isWordTimestamp)
      : []

  return {
    audio: Buffer.from(value.audio, "base64"),
    wordTimestamps,
    timing: parseWordTimingResult(value, engineName),
  }
}

function parseWordTimingResult(
  value: Record<string, unknown>,
  engineName: string,
): TtsWordTimingResult {
  if (
    !("timing" in value) ||
    !value.timing ||
    typeof value.timing !== "object"
  ) {
    throw new Error(`Invalid ${engineName} TTS timing response`)
  }

  const timing = value.timing as Record<string, unknown>
  if (timing.source !== "native" && timing.source !== "forced_alignment") {
    throw new Error(`Invalid ${engineName} TTS timing source`)
  }
  if (
    timing.status !== "ok" &&
    timing.status !== "unavailable" &&
    timing.status !== "failed"
  ) {
    throw new Error(`Invalid ${engineName} TTS timing status`)
  }
  if (timing.error !== null && typeof timing.error !== "string") {
    throw new Error(`Invalid ${engineName} TTS timing error`)
  }

  return {
    source: timing.source,
    status: timing.status,
    error: timing.error,
    diagnostics: "diagnostics" in timing ? timing.diagnostics : null,
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
