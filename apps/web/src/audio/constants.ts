// prettier-ignore
export const AMBIENT_SOUNDS = [
  { id: "fireplace-1", name: "Fireplace 1", src: "/audio/ambience/fireplace_1.mp3" },
  { id: "fireplace-2", name: "Fireplace 2", src: "/audio/ambience/fireplace_2.mp3" },
  { id: "creek", name: "Creek", src: "/audio/ambience/creek.mp3" },
  { id: "underwater", name: "Underwater", src: "/audio/ambience/underwater.mp3" },
  { id: "rain-1", name: "Rain 1", src: "/audio/ambience/rain_1.mp3" },
  { id: "rain-2", name: "Rain 2", src: "/audio/ambience/rain_2.mp3" },
  {
    id: "brown-noise",
    name: "Brown Noise",
    src: "/audio/ambience/brown_noise.mp3",
  },
  { id: "forest", name: "Forest", src: null },
  { id: "ocean", name: "Ocean", src: "/audio/ambience/ocean_waves.mp3" },
  { id: "thunder", name: "Thunder", src: "/audio/ambience/dry_thunder.mp3" },
  { id: "thunderstorm", name: "Thunderstorm", src: "/audio/ambience/thunderstorm.mp3" },
] as const

// prettier-ignore
export const MUSIC_TRACKS = [
  { id: "dawn-of-time", name: "Dawn of Time", src: "/audio/music/dawn_of_time.mp3", previewStart: 31.5 },
  { id: "distant-echo", name: "Distant Echo", src: "/audio/music/Distant Echo - Jakob Ahlbom.mp3", previewStart: 78 },
  { id: "flora-and-fauna", name: "Flora and Fauna", src: "/audio/music/Flora and Fauna - Aerian.mp3", previewStart: 78 },
  { id: "into-the-forest", name: "Into the Forest", src: "/audio/music/Into the Forest - Jakob Ahlbom.mp3", previewStart: 108 },
  { id: "rimfrost", name: "Rimfrost", src: "/audio/music/Rimfrost - Strom.mp3", previewStart: 26 },
  { id: "sen", name: "Sen", src: "/audio/music/Sen - Trevor Kowalski.mp3", previewStart: 31 },
  { id: "something-good", name: "Something Good Will Come Out of This", src: "/audio/music/Something Good Will Come Out of This - Hanna Lindgren.mp3", previewStart: 35 },
  { id: "tides", name: "Tides", src: "/audio/music/Tides - Jakob Ahlbom.mp3", previewStart: 34 },
] as const

export const DEFAULT_PRESETS: readonly { id: string; name: string }[] = []
