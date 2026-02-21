import { createSetting } from "@/settings/create-setting"
import { COLOR_THEMES, type ColorTheme } from "@/constants/color-themes"

const VALID_THEMES = new Set(COLOR_THEMES.map((t) => t.id))

export const useColorTheme = createSetting<ColorTheme>({
  key: "color-theme",
  attribute: "data-color-theme",
  defaultValue: "basic",
  validate: (v): v is ColorTheme => VALID_THEMES.has(v as ColorTheme),
  label: "Color theme",
  onApply: (theme) => {
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
  },
})
