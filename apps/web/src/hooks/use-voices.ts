import { useEffect, useMemo } from "react"
import {
  VOICES,
  type Voice,
  type VoiceCapabilities,
} from "@academic-reader/api-client/schemas/tts"

export type { Voice, VoiceCapabilities }

export function useVoices() {
  return { voices: VOICES, loading: false }
}

export function useVoiceSelection(
  currentVoice: string,
  onChange: (voiceId: string) => void,
) {
  const { voices } = useVoices()

  useEffect(() => {
    if (!voices.length) return

    const isValid = voices.some((voice) => voice.id === currentVoice)
    if (!isValid) {
      onChange(voices[0].id)
    }
  }, [voices, currentVoice, onChange])

  return { voices, loading: false }
}

export function useCurrentVoiceCapabilities(
  voiceId: string,
): VoiceCapabilities | null {
  const { voices } = useVoices()
  return useMemo(
    () => voices.find((v) => v.id === voiceId)?.capabilities ?? null,
    [voices, voiceId],
  )
}
