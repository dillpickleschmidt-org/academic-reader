export const VOICES = [
  { value: "male_1", label: "Male 1" },
  { value: "female_1", label: "Female 1" },
] as const

// prettier-ignore
export const AMBIENT_SOUNDS = [
  {
    id: "brown-noise",
    name: "Brown Noise",
    src: "/audio/ambience/deep_brown_noise.mp3",
  },
  { id: "creek", name: "Creek", src: "/audio/ambience/creek.mp3" },
  { id: "underwater", name: "Underwater", src: "/audio/ambience/underwater.mp3" },
  { id: "rain", name: "Rain", src: null },
  { id: "fireplace-1", name: "Fireplace 1", src: "/audio/ambience/fireplace_1.mp3" },
  { id: "fireplace-2", name: "Fireplace 2", src: "/audio/ambience/fireplace_2.mp3" },
  { id: "forest", name: "Forest", src: null },
  { id: "ocean", name: "Ocean", src: null },
  { id: "thunder", name: "Thunder", src: "/audio/ambience/dry_thunder.mp3" },
  { id: "thunderstorm", name: "Thunderstorm", src: "/audio/ambience/cozy_thunderstorm.mp3" },
] as const

export const MUSIC_TRACKS = [
  {
    id: "dawn-of-time",
    name: "Dawn of Time",
    src: "/audio/music/dawn_of_time.mp3",
    previewStart: 31.5,
  },
  { id: "lofi", name: "Lo-fi beats", src: null, previewStart: 0 },
  { id: "classical", name: "Classical piano", src: null, previewStart: 0 },
  { id: "jazz", name: "Jazz cafe", src: null, previewStart: 0 },
  { id: "synthwave", name: "Synthwave", src: null, previewStart: 0 },
] as const

export const DEFAULT_PRESETS: readonly { id: string; name: string }[] = []
