import { useState, useEffect } from "react"
import type { ColorTheme } from "@/constants/color-themes"

const STORAGE_KEY = "color-theme"

export function useColorTheme() {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    if (typeof window === "undefined") return "basic"
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === "basic" || saved === "amethyst-haze") {
        return saved
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

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch (error) {
      console.warn("Failed to save color theme preference:", error)
    }
  }, [theme])

  return [theme, setTheme] as const
}
