export interface SettingDef<T extends string = string> {
  key: string
  attribute: string
  defaultValue: T
  validate: (v: string) => v is T
  label: string
  description?: string
  onApply?: (v: T) => void
}

type OnOff = "on" | "off"

export const SETTINGS = {
  tabIndent: {
    key: "tab-indent",
    attribute: "data-tab-indent",
    defaultValue: "on" as OnOff,
    validate: (v: string): v is OnOff => v === "on" || v === "off",
    label: "Tab indentation",
    description: "Indent first line of paragraphs",
  },
} satisfies Record<string, SettingDef>

export type SettingsKey = keyof typeof SETTINGS
