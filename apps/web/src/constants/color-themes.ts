export const COLOR_THEMES = [
  { id: "basic", name: "Basic" },
  { id: "amethyst-haze", name: "Amethyst Haze" },
  { id: "bifurcate", name: "Bifurcate" },
  { id: "perpetuity", name: "Perpetuity" },
  { id: "notebook", name: "Notebook" },
  { id: "rose-quartz", name: "Rose Quartz" },
  { id: "vintage-paper", name: "Vintage Paper" },
] as const

export type ColorTheme = (typeof COLOR_THEMES)[number]["id"]
