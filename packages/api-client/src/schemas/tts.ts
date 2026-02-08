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
