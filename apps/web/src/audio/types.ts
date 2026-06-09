import type { AMBIENT_SOUNDS } from "./constants"

export type VoiceId = string

// Music types
export type MusicTrack = {
  id: string
  name: string
  src: string | null
}

type MusicState = {
  playlist: MusicTrack[]
  currentTrackIndex: number
  isPlaying: boolean
  volume: number
  shuffle: boolean
  loop: boolean
}

// Ambience types
export type AmbientSoundId = (typeof AMBIENT_SOUNDS)[number]["id"]

type AmbientSoundState = {
  id: AmbientSoundId
  name: string
  src: string | null
  enabled: boolean
  volume: number
}

// TTS types
type WordTimestamp = {
  word: string
  startMs: number
  endMs: number
}

type PlaybackMode = "idle" | "loading" | "waiting" | "ready"

// Unified Audio State
export type AudioState = {
  // Narrator settings
  narrator: {
    voice: VoiceId
    speed: number // 0.5 - 2.0
    volume: number // 0 - 1
  }

  // TTS playback state
  playback: {
    mode: PlaybackMode
    blockId: string | null
    error: string | null
    text: string | null
    durationMs: number
    currentTime: number
    isPlaying: boolean
    wordTimestamps: WordTimestamp[]
  }

  // Music settings
  music: MusicState

  // Ambience settings
  ambience: {
    sounds: AmbientSoundState[]
  }

  // Master settings
  master: {
    volume: number
    activePreset: string | null
  }
}
