import { useCallback, useSyncExternalStore } from "react"
import {
  DEFAULT_VOICE_ID,
  isVoiceId,
} from "@academic-reader/api-client/schemas/tts"

const KEY = "narrator-voice"
const listeners = new Set<() => void>()
let storageListenerActive = false

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
  notifyNarratorVoiceListeners()
  return true
}

export function subscribeNarratorVoicePreference(listener: () => void) {
  listeners.add(listener)
  attachStorageListener()
  return () => {
    listeners.delete(listener)
    detachStorageListenerIfIdle()
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

function notifyNarratorVoiceListeners() {
  listeners.forEach((listener) => listener())
}

function attachStorageListener() {
  if (storageListenerActive || typeof window === "undefined") return
  window.addEventListener("storage", onStorage)
  storageListenerActive = true
}

function detachStorageListenerIfIdle() {
  if (!storageListenerActive || listeners.size > 0 || typeof window === "undefined") {
    return
  }
  window.removeEventListener("storage", onStorage)
  storageListenerActive = false
}

function onStorage(event: StorageEvent) {
  if (event.key === KEY) notifyNarratorVoiceListeners()
}
