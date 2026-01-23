import { useState, useEffect } from "react"
import type { ReaderTheme } from "../constants/themes"

export type { ReaderTheme }

export function useReaderTheme() {
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    if (typeof window === "undefined") return "light"
    try {
      const saved = localStorage.getItem("reader-theme")
      if (saved === "sepia") return "comfort"
      if (saved === "light" || saved === "dark" || saved === "comfort") {
        return saved
      }
      // No preference saved - follow system theme
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
    } catch {
      return "light"
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    // Set reader mode on document for app-wide styling (e.g., sidebar sepia)
    document.documentElement.setAttribute("data-reader-mode", theme)

    // Toggle app-wide dark mode based on theme
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }

    // Persist to localStorage
    try {
      localStorage.setItem("reader-theme", theme)
    } catch (error) {
      console.warn("Failed to save theme preference:", error)
    }
  }, [theme])
  return [theme, setTheme] as const
}
