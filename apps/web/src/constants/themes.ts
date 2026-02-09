import { Sun, BookOpen, Moon } from "lucide-react"

export const THEMES = [
  { id: "light", icon: Sun, title: "Light" },
  { id: "comfort", icon: BookOpen, title: "Comfort" },
  { id: "dark", icon: Moon, title: "Dark" },
] as const

export type ReaderTheme = (typeof THEMES)[number]["id"]
