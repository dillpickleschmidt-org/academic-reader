import { createSetting } from "@/settings/create-setting"
import type { TypographyStyle } from "@/constants/typography-styles"

const VALID: Set<string> = new Set(["classic", "modern"])

export const useTypographyStyle = createSetting<TypographyStyle>({
  key: "typography-style",
  attribute: "data-typography-style",
  defaultValue: "classic",
  validate: (v): v is TypographyStyle => VALID.has(v),
  label: "Typography",
})
