import { useCallback, useSyncExternalStore } from "react"
import {
  DEFAULT_VOICE_ID,
  isVoiceId,
} from "@academic-reader/api-client/schemas/tts"

const KEY = "narrator-voice"
const listeners = new Set<() => void>()

export function getNarratorVoicePreference(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE_ID
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && isVoiceId(saved)) return saved
  } catch {}
  return DEFAULT_VOICE_ID
}

export function setNarratorVoicePreference(voiceId: string): boolean {
  if (!isVoiceId(voiceId)) return false
  try {
    localStorage.setItem(KEY, voiceId)
  } catch {}
  listeners.forEach((listener) => listener())
  return true
}

export function subscribeNarratorVoicePreference(listener: () => void) {
  listeners.add(listener)
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener)
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useNarratorVoicePreference(): [string, (voiceId: string) => void] {
  const voiceId = useSyncExternalStore(
    subscribeNarratorVoicePreference,
    getNarratorVoicePreference,
    () => DEFAULT_VOICE_ID,
  )

  const setVoiceId = useCallback((next: string) => {
    setNarratorVoicePreference(next)
  }, [])

  return [voiceId, setVoiceId]
}
