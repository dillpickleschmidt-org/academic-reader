import { Schema } from "effect"

export const WordTimestamp = Schema.Struct({
  word: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
})
export type WordTimestamp = typeof WordTimestamp.Type

export const CachedAudio = Schema.Struct({
  storagePath: Schema.String,
  durationMs: Schema.Number,
  sampleRate: Schema.Number,
  wordTimestamps: Schema.Array(WordTimestamp),
})
export type CachedAudio = typeof CachedAudio.Type

export const VoiceCapabilities = Schema.Struct({
  perBlock: Schema.Boolean,
  fullDocument: Schema.Boolean,
})
export type VoiceCapabilities = typeof VoiceCapabilities.Type

export const TTSEngine = Schema.Literal("qwen3", "kokoro")
export type TTSEngine = typeof TTSEngine.Type

export const Voice = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  engine: TTSEngine,
  capabilities: VoiceCapabilities,
})
export type Voice = typeof Voice.Type

export const VoicesResponse = Schema.Struct({
  voices: Schema.Array(Voice),
})
export type VoicesResponse = typeof VoicesResponse.Type

export const VOICES: Voice[] = [
  {
    id: "male_1",
    displayName: "Male 1",
    engine: "qwen3",
    capabilities: { perBlock: true, fullDocument: true },
  },
  {
    id: "female_1",
    displayName: "Female 1",
    engine: "kokoro",
    capabilities: { perBlock: false, fullDocument: true },
  },
  {
    id: "female_2",
    displayName: "Female 2",
    engine: "kokoro",
    capabilities: { perBlock: false, fullDocument: true },
  },
]
