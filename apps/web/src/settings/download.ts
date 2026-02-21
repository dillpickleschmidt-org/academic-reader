import { SETTINGS } from "./registry"

export function resolveDownloadSettings(): Record<string, string> {
  const useWeb = readLocal("download-use-web-settings", "on")
  const result: Record<string, string> = {}

  for (const [name, def] of Object.entries(SETTINGS)) {
    const key = useWeb === "on" ? def.key : `download-${def.key}`
    const raw = readLocal(key, def.defaultValue)
    result[name] = def.validate(raw) ? raw : def.defaultValue
  }

  return result
}

function readLocal(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
