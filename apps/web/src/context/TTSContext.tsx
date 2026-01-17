import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useSyncExternalStore,
  useEffect,
  type ReactNode,
} from "react"
import { toast } from "sonner"

type TTSState = {
  isEnabled: boolean
  isLoading: boolean
  currentBlockId: string | null
  rewordedText: string | null
  error: string | null
  // Audio playback state
  audioUrl: string | null
  isPlaying: boolean
  isSynthesizing: boolean
  currentVoice: string
  duration: number
  currentTime: number
}

type TTSStore = {
  getState: () => TTSState
  setState: (partial: Partial<TTSState>) => void
  subscribe: (listener: () => void) => () => void
}

function createStore(initial: TTSState): TTSStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial }
      listeners.forEach((l) => l())
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

type TTSActions = {
  enable: () => void
  disable: () => void
  loadChunkTTS: (blockId: string, chunkContent: string) => Promise<void>
  synthesize: () => Promise<void>
  play: () => void
  pause: () => void
  togglePlayPause: () => void
  skip: (seconds: number) => void
  setVoice: (voiceId: string) => void
}

const TTSContext = createContext<{
  store: TTSStore
  actions: TTSActions
  audioRef: React.RefObject<HTMLAudioElement | null>
} | null>(null)

/**
 * Convert base64 audio to a blob URL.
 */
function createAudioUrl(base64Audio: string): string {
  const binary = atob(base64Audio)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const blob = new Blob([bytes], { type: "audio/wav" })
  return URL.createObjectURL(blob)
}

export function TTSProvider({
  documentId,
  children,
}: {
  documentId: string | null
  children: ReactNode
}) {
  const storeRef = useRef<TTSStore>(null!)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  if (!storeRef.current) {
    storeRef.current = createStore({
      isEnabled: false,
      isLoading: false,
      currentBlockId: null,
      rewordedText: null,
      error: null,
      audioUrl: null,
      isPlaying: false,
      isSynthesizing: false,
      currentVoice: "male_1",
      duration: 0,
      currentTime: 0,
    })
  }
  const store = storeRef.current

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      const { audioUrl } = store.getState()
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [store])

  const enable = useCallback(() => {
    store.setState({ isEnabled: true, error: null })
  }, [store])

  const disable = useCallback(() => {
    // Stop audio and cleanup
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }
    const { audioUrl } = store.getState()
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    store.setState({
      isEnabled: false,
      rewordedText: null,
      currentBlockId: null,
      error: null,
      audioUrl: null,
      isPlaying: false,
      isSynthesizing: false,
      duration: 0,
      currentTime: 0,
    })
  }, [store])

  const synthesize = useCallback(async () => {
    const state = store.getState()
    if (!documentId || !state.currentBlockId || !state.rewordedText) {
      return
    }

    // Cleanup previous audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }
    if (state.audioUrl) {
      URL.revokeObjectURL(state.audioUrl)
    }

    store.setState({ isSynthesizing: true, audioUrl: null, isPlaying: false })
    const toastId = toast.loading("Generating speech...")

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          documentId,
          blockId: state.currentBlockId,
          voiceId: state.currentVoice,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to synthesize speech")
      }

      const data = await response.json()
      const audioUrl = createAudioUrl(data.audio)

      store.setState({
        audioUrl,
        isSynthesizing: false,
        duration: data.durationMs / 1000,
      })

      // Auto-play the audio
      if (audioRef.current) {
        audioRef.current.src = audioUrl
        audioRef.current.play()
        store.setState({ isPlaying: true })
      }

      toast.success("Speech generated", { id: toastId })
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Speech synthesis failed"
      store.setState({ error: errorMsg, isSynthesizing: false })
      toast.error(errorMsg, { id: toastId })
    }
  }, [store, documentId])

  const loadChunkTTS = useCallback(
    async (blockId: string, chunkContent: string) => {
      if (!documentId) {
        store.setState({
          error: "Document not saved - TTS requires a saved document",
        })
        toast.error("Document not saved - TTS requires a saved document")
        return
      }

      // Stop current playback if switching blocks
      const currentState = store.getState()
      if (currentState.currentBlockId !== blockId) {
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ""
        }
        if (currentState.audioUrl) {
          URL.revokeObjectURL(currentState.audioUrl)
        }
        store.setState({
          audioUrl: null,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
        })
      }

      store.setState({ isLoading: true, error: null, currentBlockId: blockId })
      const toastId = toast.loading("Preparing text for speech...")

      try {
        const response = await fetch("/api/tts/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ documentId, blockId, chunkContent }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || "Failed to reword text")
        }

        const data = await response.json()
        store.setState({ rewordedText: data.rewordedText, isLoading: false })
        toast.dismiss(toastId)

        // Auto-synthesize after rewrite
        // Use setTimeout to allow state to update before synthesize reads it
        setTimeout(async () => {
          // Get fresh state and synthesize
          const freshStore = store.getState()
          if (
            freshStore.rewordedText &&
            freshStore.currentBlockId === blockId
          ) {
            store.setState({ isSynthesizing: true })
            const synthToastId = toast.loading("Generating speech...")

            try {
              const synthResponse = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                  documentId,
                  blockId,
                  voiceId: freshStore.currentVoice,
                }),
              })

              if (!synthResponse.ok) {
                const synthData = await synthResponse.json().catch(() => ({}))
                throw new Error(
                  synthData.error || "Failed to synthesize speech",
                )
              }

              const synthData = await synthResponse.json()
              const audioUrl = createAudioUrl(synthData.audio)

              store.setState({
                audioUrl,
                isSynthesizing: false,
                duration: synthData.durationMs / 1000,
              })

              // Auto-play the audio
              if (audioRef.current) {
                audioRef.current.src = audioUrl
                audioRef.current.play()
                store.setState({ isPlaying: true })
              }

              toast.success("Speech ready", { id: synthToastId })
            } catch (err) {
              const errorMsg =
                err instanceof Error ? err.message : "Speech synthesis failed"
              store.setState({ error: errorMsg, isSynthesizing: false })
              toast.error(errorMsg, { id: synthToastId })
            }
          }
        }, 0)
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "TTS processing failed"
        store.setState({
          error: errorMsg,
          rewordedText: null,
          isLoading: false,
        })
        toast.error(errorMsg, { id: toastId })
      }
    },
    [store, documentId],
  )

  const play = useCallback(() => {
    if (audioRef.current && store.getState().audioUrl) {
      audioRef.current.play()
      store.setState({ isPlaying: true })
    }
  }, [store])

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      store.setState({ isPlaying: false })
    }
  }, [store])

  const togglePlayPause = useCallback(() => {
    if (store.getState().isPlaying) {
      pause()
    } else {
      play()
    }
  }, [store, play, pause])

  const skip = useCallback((seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(
          audioRef.current.duration || 0,
          audioRef.current.currentTime + seconds,
        ),
      )
    }
  }, [])

  const setVoice = useCallback(
    (voiceId: string) => {
      const state = store.getState()
      if (state.currentVoice === voiceId) return

      store.setState({ currentVoice: voiceId })

      // If we have reworded text, re-synthesize with new voice
      if (state.rewordedText && state.currentBlockId) {
        // Stop current playback
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ""
        }
        if (state.audioUrl) {
          URL.revokeObjectURL(state.audioUrl)
        }
        store.setState({ audioUrl: null, isPlaying: false })

        // Synthesize with new voice
        synthesize()
      }
    },
    [store, synthesize],
  )

  // Set up audio event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      store.setState({ isPlaying: false, currentTime: 0 })
    }

    const handleTimeUpdate = () => {
      store.setState({ currentTime: audio.currentTime })
    }

    const handlePlay = () => {
      store.setState({ isPlaying: true })
    }

    const handlePause = () => {
      store.setState({ isPlaying: false })
    }

    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("play", handlePlay)
    audio.addEventListener("pause", handlePause)

    return () => {
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("play", handlePlay)
      audio.removeEventListener("pause", handlePause)
    }
  }, [store])

  const valueRef = useRef<{
    store: TTSStore
    actions: TTSActions
    audioRef: React.RefObject<HTMLAudioElement | null>
  }>(null!)
  if (!valueRef.current) {
    valueRef.current = {
      store,
      actions: {
        enable,
        disable,
        loadChunkTTS,
        synthesize,
        play,
        pause,
        togglePlayPause,
        skip,
        setVoice,
      },
      audioRef,
    }
  }
  valueRef.current.actions = {
    enable,
    disable,
    loadChunkTTS,
    synthesize,
    play,
    pause,
    togglePlayPause,
    skip,
    setVoice,
  }

  return (
    <TTSContext.Provider value={valueRef.current}>
      {/* Hidden audio element */}
      <audio ref={audioRef} />
      {children}
    </TTSContext.Provider>
  )
}

function useTTSContext() {
  const ctx = useContext(TTSContext)
  if (!ctx) throw new Error("TTS hooks must be used within TTSProvider")
  return ctx
}

export function useTTSSelector<T>(selector: (state: TTSState) => T): T {
  const { store } = useTTSContext()
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}

export function useTTSActions(): TTSActions {
  return useTTSContext().actions
}

export function useTTSAudioRef(): React.RefObject<HTMLAudioElement | null> {
  return useTTSContext().audioRef
}
