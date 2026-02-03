import { useState, useEffect } from "react"
import { COLOR_THEMES, type ColorTheme } from "@/constants/color-themes"

const STORAGE_KEY = "color-theme"
const VALID_THEMES = new Set(COLOR_THEMES.map((t) => t.id))

export function useColorTheme() {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    if (typeof window === "undefined") return "basic"
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && VALID_THEMES.has(saved as ColorTheme)) {
        return saved as ColorTheme
      }
      return "basic"
    } catch {
      return "basic"
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    // Apply to document
    document.documentElement.setAttribute("data-color-theme", theme)

    // Dynamically load theme fonts
    if (theme === "amethyst-haze") {
      import("@fontsource-variable/geist")
      import("@fontsource-variable/lora")
    } else if (theme === "perpetuity" || theme === "bifurcate") {
      import("@fontsource-variable/source-code-pro")
    } else if (theme === "notebook") {
      import("@fontsource/architects-daughter")
    } else if (theme === "vintage-paper") {
      import("@fontsource/libre-baskerville")
      import("@fontsource-variable/lora")
      import("@fontsource/ibm-plex-mono")
    }

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch (error) {
      console.warn("Failed to save color theme preference:", error)
    }
  }, [theme])

  return [theme, setTheme] as const
}
