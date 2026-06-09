import { createSetting } from "@/settings/create-setting"
import type { ReaderTheme } from "@/constants/themes"

const VALID: Set<string> = new Set(["light", "comfort", "dark"])

export const useReaderTheme = createSetting<ReaderTheme>({
  key: "reader-theme",
  attribute: "data-reader-mode",
  defaultValue:
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  validate: (v): v is ReaderTheme => VALID.has(v),
  label: "Reader theme",
  onApply: (theme) => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  },
})
