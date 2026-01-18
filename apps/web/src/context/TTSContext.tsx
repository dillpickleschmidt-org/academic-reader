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

type SegmentStatus = "pending" | "loading" | "ready" | "error"

type TTSSegment = {
  index: number
  text: string
  audioUrl: string | null
  durationMs: number | null
  status: SegmentStatus
}

type TTSState = {
  isEnabled: boolean
  isLoading: boolean
  currentBlockId: string | null
  error: string | null
  // Segment-based state
  segments: TTSSegment[]
  currentSegmentIndex: number
  // Playback state
  isPlaying: boolean
  isSynthesizing: boolean
  currentVoice: string
  // Computed from segments
  totalDuration: number
  currentTime: number
  segmentCurrentTime: number
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
  loadBlockTTS: (blockId: string, chunkContent: string) => Promise<void>
  play: () => void
  pause: () => void
  togglePlayPause: () => void
  skip: (seconds: number) => void
  setVoice: (voiceId: string) => void
  goToSegment: (index: number) => void
}

const TTSContext = createContext<{
  store: TTSStore
  actions: TTSActions
  audioRef: React.RefObject<HTMLAudioElement | null>
} | null>(null)

export function TTSProvider({
  documentId,
  children,
}: {
  documentId: string | null
  children: ReactNode
}) {
  const storeRef = useRef<TTSStore>(null!)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Track if we're waiting for next segment to be ready
  const waitingForNextRef = useRef(false)
  // Track ongoing fetches to avoid duplicates
  const fetchingSegmentsRef = useRef(new Set<number>())

  if (!storeRef.current) {
    storeRef.current = createStore({
      isEnabled: false,
      isLoading: false,
      currentBlockId: null,
      error: null,
      segments: [],
      currentSegmentIndex: 0,
      isPlaying: false,
      isSynthesizing: false,
      currentVoice: "male_1",
      totalDuration: 0,
      currentTime: 0,
      segmentCurrentTime: 0,
    })
  }
  const store = storeRef.current

  // Fetch audio for a specific segment
  const fetchSegmentAudio = useCallback(
    async (segmentIndex: number): Promise<boolean> => {
      const state = store.getState()
      if (!documentId || !state.currentBlockId) return false

      const segment = state.segments[segmentIndex]
      if (
        !segment ||
        segment.status === "ready" ||
        segment.status === "loading"
      )
        return segment?.status === "ready"

      // Check if already fetching
      if (fetchingSegmentsRef.current.has(segmentIndex)) return false
      fetchingSegmentsRef.current.add(segmentIndex)

      // Update segment status to loading
      const updatedSegments = [...state.segments]
      updatedSegments[segmentIndex] = { ...segment, status: "loading" }
      store.setState({ segments: updatedSegments, isSynthesizing: true })

      try {
        const response = await fetch("/api/tts/segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            documentId,
            blockId: state.currentBlockId,
            segmentIndex,
            voiceId: state.currentVoice,
          }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || "Failed to synthesize segment")
        }

        const data = await response.json()

        // Update segment with audio URL
        const freshState = store.getState()
        const newSegments = [...freshState.segments]
        newSegments[segmentIndex] = {
          ...newSegments[segmentIndex],
          audioUrl: data.audioUrl,
          durationMs: data.durationMs,
          status: "ready",
        }

        // Recalculate total duration
        const totalDuration =
          newSegments.reduce((sum, s) => sum + (s.durationMs || 0), 0) / 1000

        // Check if any segment is still loading
        const stillSynthesizing = newSegments.some(
          (s) => s.status === "loading",
        )

        store.setState({
          segments: newSegments,
          totalDuration,
          isSynthesizing: stillSynthesizing,
        })

        fetchingSegmentsRef.current.delete(segmentIndex)
        return true
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Segment synthesis failed"

        const freshState = store.getState()
        const newSegments = [...freshState.segments]
        newSegments[segmentIndex] = {
          ...newSegments[segmentIndex],
          status: "error",
        }

        const stillSynthesizing = newSegments.some(
          (s) => s.status === "loading",
        )
        store.setState({
          segments: newSegments,
          error: errorMsg,
          isSynthesizing: stillSynthesizing,
        })

        fetchingSegmentsRef.current.delete(segmentIndex)
        return false
      }
    },
    [store, documentId],
  )

  // Play a specific segment
  const playSegment = useCallback(
    async (segmentIndex: number) => {
      const state = store.getState()
      const segment = state.segments[segmentIndex]
      if (!segment) return

      if (segment.status === "ready" && segment.audioUrl && audioRef.current) {
        store.setState({ currentSegmentIndex: segmentIndex })
        audioRef.current.src = segment.audioUrl
        audioRef.current.play()
        store.setState({ isPlaying: true })

        // Pre-fetch next segment
        if (segmentIndex + 1 < state.segments.length) {
          fetchSegmentAudio(segmentIndex + 1)
        }
      } else if (segment.status === "pending") {
        // Need to load this segment first
        waitingForNextRef.current = true
        store.setState({ currentSegmentIndex: segmentIndex })
        await fetchSegmentAudio(segmentIndex)
      }
    },
    [store, fetchSegmentAudio],
  )

  const enable = useCallback(() => {
    store.setState({ isEnabled: true, error: null })
  }, [store])

  const disable = useCallback(() => {
    // Stop audio and cleanup
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }
    waitingForNextRef.current = false
    fetchingSegmentsRef.current.clear()
    store.setState({
      isEnabled: false,
      segments: [],
      currentBlockId: null,
      error: null,
      isPlaying: false,
      isSynthesizing: false,
      currentSegmentIndex: 0,
      totalDuration: 0,
      currentTime: 0,
      segmentCurrentTime: 0,
    })
  }, [store])

  const loadBlockTTS = useCallback(
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
        waitingForNextRef.current = false
        fetchingSegmentsRef.current.clear()
        store.setState({
          segments: [],
          isPlaying: false,
          currentSegmentIndex: 0,
          currentTime: 0,
          totalDuration: 0,
          segmentCurrentTime: 0,
        })
      }

      store.setState({ isLoading: true, error: null, currentBlockId: blockId })
      const toastId = toast.loading("Preparing text for speech...")

      try {
        // Step 1: Get segments (may be cached)
        const response = await fetch("/api/tts/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ documentId, blockId, chunkContent }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || "Failed to prepare text")
        }

        const data = await response.json()

        // Initialize segments with pending status
        const segments: TTSSegment[] = data.segments.map(
          (s: Pick<TTSSegment, "index" | "text">) => ({
            index: s.index,
            text: s.text,
            audioUrl: null,
            durationMs: null,
            status: "pending" as SegmentStatus,
          }),
        )

        store.setState({ segments, isLoading: false })
        toast.dismiss(toastId)

        if (segments.length === 0) {
          toast.error("No text to synthesize")
          return
        }

        // Step 2: Immediately request first segment audio
        toast.loading("Generating speech...", { id: "tts-synth" })
        const success = await fetchSegmentAudio(0)

        if (success) {
          const freshState = store.getState()
          const firstSegment = freshState.segments[0]

          if (firstSegment?.audioUrl && audioRef.current) {
            audioRef.current.src = firstSegment.audioUrl
            audioRef.current.play()
            store.setState({ isPlaying: true, currentSegmentIndex: 0 })
            toast.success("Speech ready", { id: "tts-synth" })

            // Pre-fetch second segment
            if (segments.length > 1) {
              fetchSegmentAudio(1)
            }
          }
        } else {
          toast.error("Failed to generate speech", { id: "tts-synth" })
        }
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "TTS processing failed"
        store.setState({
          error: errorMsg,
          segments: [],
          isLoading: false,
        })
        toast.error(errorMsg, { id: toastId })
      }
    },
    [store, documentId, fetchSegmentAudio],
  )

  const play = useCallback(() => {
    const state = store.getState()
    const segment = state.segments[state.currentSegmentIndex]
    if (audioRef.current && segment?.audioUrl) {
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

  const skip = useCallback(
    (seconds: number) => {
      const state = store.getState()
      if (!audioRef.current || state.segments.length === 0) return

      // Calculate target time across all segments
      let targetTime = state.currentTime + seconds
      targetTime = Math.max(0, Math.min(state.totalDuration, targetTime))

      // Find which segment this time falls into
      let accumulatedTime = 0
      for (let i = 0; i < state.segments.length; i++) {
        const segmentDuration = (state.segments[i].durationMs || 0) / 1000
        if (targetTime <= accumulatedTime + segmentDuration) {
          // Target is in this segment
          const segmentTime = targetTime - accumulatedTime
          if (i === state.currentSegmentIndex) {
            // Same segment - just seek
            audioRef.current.currentTime = segmentTime
          } else {
            // Different segment - need to switch
            const segment = state.segments[i]
            if (segment.status === "ready" && segment.audioUrl) {
              store.setState({ currentSegmentIndex: i })
              audioRef.current.src = segment.audioUrl
              audioRef.current.currentTime = segmentTime
              if (state.isPlaying) {
                audioRef.current.play()
              }
            }
          }
          return
        }
        accumulatedTime += segmentDuration
      }
    },
    [store],
  )

  const goToSegment = useCallback(
    (index: number) => {
      const state = store.getState()
      if (index < 0 || index >= state.segments.length) return
      playSegment(index)
    },
    [store, playSegment],
  )

  const setVoice = useCallback(
    (voiceId: string) => {
      const state = store.getState()
      if (state.currentVoice === voiceId) return

      const wasPlaying = state.isPlaying

      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ""
      }

      // Clear all audio and reset to pending
      const resetSegments = state.segments.map((s) => ({
        ...s,
        audioUrl: null,
        durationMs: null,
        status: "pending" as SegmentStatus,
      }))

      fetchingSegmentsRef.current.clear()

      store.setState({
        currentVoice: voiceId,
        segments: resetSegments,
        isPlaying: false,
        totalDuration: 0,
        currentTime: 0,
        segmentCurrentTime: 0,
      })

      // Re-synthesize current segment with new voice
      if (resetSegments.length > 0) {
        fetchSegmentAudio(state.currentSegmentIndex).then((success) => {
          if (success) {
            const freshState = store.getState()
            const segment = freshState.segments[state.currentSegmentIndex]
            if (segment?.audioUrl && audioRef.current) {
              audioRef.current.src = segment.audioUrl
              // Only resume if it was playing before voice change
              if (wasPlaying) {
                audioRef.current.play()
                store.setState({ isPlaying: true })
              }
            }
          }
        })
      }
    },
    [store, fetchSegmentAudio],
  )

  // Set up audio event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      const state = store.getState()
      const nextIndex = state.currentSegmentIndex + 1

      if (nextIndex < state.segments.length) {
        // Play next segment
        const nextSegment = state.segments[nextIndex]
        if (nextSegment.status === "ready" && nextSegment.audioUrl) {
          store.setState({ currentSegmentIndex: nextIndex })
          audio.src = nextSegment.audioUrl
          audio.play()

          // Pre-fetch the segment after next
          if (nextIndex + 1 < state.segments.length) {
            fetchSegmentAudio(nextIndex + 1)
          }
        } else {
          // Next segment not ready - wait for it
          waitingForNextRef.current = true
          store.setState({ currentSegmentIndex: nextIndex, isPlaying: false })
          fetchSegmentAudio(nextIndex)
        }
      } else {
        // All segments finished
        store.setState({ isPlaying: false, segmentCurrentTime: 0 })
      }
    }

    const handleTimeUpdate = () => {
      const state = store.getState()
      const segmentCurrentTime = audio.currentTime

      // Calculate total time = sum of previous segments + current position
      let previousDuration = 0
      for (let i = 0; i < state.currentSegmentIndex; i++) {
        previousDuration += (state.segments[i]?.durationMs || 0) / 1000
      }
      const currentTime = previousDuration + segmentCurrentTime

      store.setState({ currentTime, segmentCurrentTime })
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
  }, [store, fetchSegmentAudio])

  // Watch for segment becoming ready when we're waiting
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      if (!waitingForNextRef.current) return

      const state = store.getState()
      const segment = state.segments[state.currentSegmentIndex]

      if (segment?.status === "ready" && segment.audioUrl && audioRef.current) {
        waitingForNextRef.current = false
        audioRef.current.src = segment.audioUrl
        audioRef.current.play()
        store.setState({ isPlaying: true })

        // Pre-fetch next segment
        if (state.currentSegmentIndex + 1 < state.segments.length) {
          fetchSegmentAudio(state.currentSegmentIndex + 1)
        }
      }
    })

    return unsubscribe
  }, [store, fetchSegmentAudio])

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
        loadBlockTTS,
        play,
        pause,
        togglePlayPause,
        skip,
        setVoice,
        goToSegment,
      },
      audioRef,
    }
  }
  valueRef.current.actions = {
    enable,
    disable,
    loadBlockTTS,
    play,
    pause,
    togglePlayPause,
    skip,
    setVoice,
    goToSegment,
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
