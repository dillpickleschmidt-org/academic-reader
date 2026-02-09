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

export const Voice = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  capabilities: VoiceCapabilities,
})
export type Voice = typeof Voice.Type

export const VoicesResponse = Schema.Struct({
  voices: Schema.Array(Voice),
})
export type VoicesResponse = typeof VoicesResponse.Type
