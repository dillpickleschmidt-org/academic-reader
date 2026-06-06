import { Schema } from "effect"
import manifest from "../tts-manifest.json"

export const WordTimestamp = Schema.Struct({
  word: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
})
export type WordTimestamp = typeof WordTimestamp.Type

export const GetBlockAudioRequest = Schema.Struct({
  documentId: Schema.String,
  blockId: Schema.String,
  voiceId: Schema.String,
})
export type GetBlockAudioRequest = typeof GetBlockAudioRequest.Type

export const GetBlockAudioResponse = Schema.Union(
  Schema.Struct({ ready: Schema.Literal(false) }),
  Schema.Struct({
    ready: Schema.Literal(true),
    audioUrl: Schema.String,
    text: Schema.String,
    durationMs: Schema.Number,
    sampleRate: Schema.Number,
    wordTimestamps: Schema.Array(WordTimestamp),
  }),
)
export type GetBlockAudioResponse = typeof GetBlockAudioResponse.Type

export const GenerateDocumentAudioRequest = Schema.Struct({
  documentId: Schema.String,
  voiceId: Schema.String,
})
export type GenerateDocumentAudioRequest = typeof GenerateDocumentAudioRequest.Type

export const GenerateDocumentAudioResult = Schema.Union(
  Schema.Struct({ started: Schema.Literal(true) }),
  Schema.Struct({
    started: Schema.Literal(false),
    complete: Schema.optional(Schema.Boolean),
    busy: Schema.optional(Schema.Boolean),
    alreadyGenerating: Schema.optional(Schema.Boolean),
  }),
)
export type GenerateDocumentAudioResult = typeof GenerateDocumentAudioResult.Type

export const TTSEngine = Schema.Literal("qwen3", "kokoro")
export type TTSEngine = typeof TTSEngine.Type

export const Voice = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  engine: TTSEngine,
})
export type Voice = typeof Voice.Type

export const TTS_SAMPLE_RATE = manifest.sampleRate
export const DEFAULT_VOICE_ID = manifest.defaultVoiceId
export const VOICES: Voice[] = manifest.voices.map((voice) => ({
  id: voice.id,
  displayName: voice.displayName,
  engine: voice.engine as TTSEngine,
}))
export const VOICE_IDS = VOICES.map((voice) => voice.id)

export function getVoice(voiceId: string): Voice | undefined {
  return VOICES.find((voice) => voice.id === voiceId)
}

export function isVoiceId(voiceId: string): boolean {
  return getVoice(voiceId) !== undefined
}
