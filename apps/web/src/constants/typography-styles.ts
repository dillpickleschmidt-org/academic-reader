export const TYPOGRAPHY_STYLES = [
  { id: "classic", name: "Classic" },
  { id: "modern", name: "Modern" },
] as const

export type TypographyStyle = (typeof TYPOGRAPHY_STYLES)[number]["id"]
