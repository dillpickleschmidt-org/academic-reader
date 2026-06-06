import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_VOICE_ID,
  isVoiceId,
} from "@academic-reader/api-client/schemas/tts"

const KEY = "narrator-voice"

export function readNarratorVoice(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE_ID
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && isVoiceId(saved)) return saved
  } catch {}
  return DEFAULT_VOICE_ID
}

export function writeNarratorVoice(voiceId: string) {
  if (!isVoiceId(voiceId)) return
  try {
    localStorage.setItem(KEY, voiceId)
  } catch {}
}

export function useNarratorVoice(): [string, (voiceId: string) => void] {
  const [voiceId, setVoiceId] = useState(readNarratorVoice)

  useEffect(() => {
    writeNarratorVoice(voiceId)
  }, [voiceId])

  const setValidVoice = useCallback((next: string) => {
    if (isVoiceId(next)) setVoiceId(next)
  }, [])

  return [voiceId, setValidVoice]
}
