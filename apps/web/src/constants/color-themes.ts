export const COLOR_THEMES = [
  { id: "basic", name: "Basic" },
  { id: "amethyst-haze", name: "Amethyst Haze" },
] as const

export type ColorTheme = (typeof COLOR_THEMES)[number]["id"]
