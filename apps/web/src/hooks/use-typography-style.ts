import { useState, useEffect } from "react"
import type { TypographyStyle } from "@/constants/typography-styles"

const STORAGE_KEY = "typography-style"

export function useTypographyStyle() {
  const [style, setStyle] = useState<TypographyStyle>(() => {
    if (typeof window === "undefined") return "classic"
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === "classic" || saved === "modern") return saved
      return "classic"
    } catch {
      return "classic"
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    document.documentElement.setAttribute("data-typography-style", style)
    try {
      localStorage.setItem(STORAGE_KEY, style)
    } catch (error) {
      console.warn("Failed to save typography style:", error)
    }
  }, [style])

  return [style, setStyle] as const
}
