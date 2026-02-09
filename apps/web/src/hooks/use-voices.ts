import { useState, useEffect, useMemo } from "react"
import { fetchVoices as apiFetchVoices } from "@academic-reader/api-client/client"
import type { Voice, VoiceCapabilities } from "@academic-reader/api-client/schemas/tts"
import { AppRuntime } from "@/lib/runtime"

export type { Voice, VoiceCapabilities }

export function useVoices() {
  const [voices, setVoices] = useState<Voice[]>(cachedVoices ?? [])
  const [loading, setLoading] = useState(!cachedVoices)

  useEffect(() => {
    if (cachedVoices) {
      setVoices(cachedVoices)
      setLoading(false)
      return
    }

    loadVoices()
      .then((data) => {
        cachedVoices = data
        setVoices(data)
        setLoading(false)
      })
      .catch(() => {
        fetchPromise = null
        setLoading(false)
      })
  }, [])

  return { voices, loading }
}

export function useVoiceSelection(
  currentVoice: string,
  onChange: (voiceId: string) => void,
) {
  const { voices, loading } = useVoices()

  useEffect(() => {
    if (!voices.length) return

    const isValid = voices.some((voice) => voice.id === currentVoice)
    if (!isValid) {
      onChange(voices[0].id)
    }
  }, [voices, currentVoice, onChange])

  return { voices, loading }
}

export function useCurrentVoiceCapabilities(voiceId: string): VoiceCapabilities | null {
  const { voices } = useVoices()
  return useMemo(
    () => voices.find((v) => v.id === voiceId)?.capabilities ?? null,
    [voices, voiceId],
  )
}

let cachedVoices: Voice[] | null = null
let fetchPromise: Promise<Voice[]> | null = null

function loadVoices(): Promise<Voice[]> {
  if (!fetchPromise) {
    fetchPromise = AppRuntime.runPromise(apiFetchVoices()).then((r) => [...r.voices])
  }

  return fetchPromise
}
