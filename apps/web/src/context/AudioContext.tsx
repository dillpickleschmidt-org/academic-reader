import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { toast } from "sonner"
import type {
  AudioState,
  TTSSegment,
  SegmentStatus,
  VoiceId,
  MusicTrack,
  AmbientSoundId,
} from "@/audio/types"
import { AMBIENT_SOUNDS } from "@/audio/constants"

// ============================================================================
// CrossfadeLooper: Encapsulates seamless audio looping with crossfade
// ============================================================================

class CrossfadeLooper {
  private readonly ctx: AudioContext
  private readonly audioA: HTMLAudioElement
  private readonly audioB: HTMLAudioElement
  private readonly gainA: GainNode
  private readonly gainB: GainNode
  private active: "a" | "b" = "a"
  private crossfadeTimeout: ReturnType<typeof setTimeout> | null = null
  private volume = 1
  private isPlaying = false
  private disposed = false

  private static readonly CROSSFADE_TIME = 0.5
  private static readonly PRE_START_TIME = 0.05 // Start audio early to avoid latency

  // Equal-power crossfade curves (constant perceived loudness)
  private static readonly fadeOutCurve = Float32Array.from(
    { length: 128 },
    (_, i) => Math.cos((i / 127) * (Math.PI / 2)),
  )
  private static readonly fadeInCurve = Float32Array.from(
    { length: 128 },
    (_, i) => Math.sin((i / 127) * (Math.PI / 2)),
  )

  constructor(ctx: AudioContext, src: string, initialVolume: number) {
    this.ctx = ctx
    this.volume = initialVolume

    // Helper to create audio element with connected gain node
    const createAudioWithGain = () => {
      const audio = new Audio(src)
      audio.loop = false
      audio.volume = 1 // GainNode controls actual volume
      const gain = ctx.createGain()
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination)
      return { audio, gain }
    }

    const { audio: a, gain: gainA } = createAudioWithGain()
    const { audio: b, gain: gainB } = createAudioWithGain()

    this.audioA = a
    this.audioB = b
    this.gainA = gainA
    this.gainB = gainB

    // Initial state: A ready to play at full volume, B silent
    this.gainA.gain.value = initialVolume
    this.gainB.gain.value = 0

    // Set up event listeners
    this.audioA.addEventListener("playing", this.handlePlayingA)
    this.audioB.addEventListener("playing", this.handlePlayingB)
  }

  private handlePlayingA = () => {
    if (this.active === "a" && this.audioA.duration) {
      this.scheduleCrossfade("a")
    }
  }

  private handlePlayingB = () => {
    if (this.active === "b" && this.audioB.duration) {
      this.scheduleCrossfade("b")
    }
  }

  private clearCrossfadeTimeout() {
    if (this.crossfadeTimeout) {
      clearTimeout(this.crossfadeTimeout)
      this.crossfadeTimeout = null
    }
  }

  private scheduleCrossfade(from: "a" | "b") {
    this.clearCrossfadeTimeout()

    const fromAudio = from === "a" ? this.audioA : this.audioB
    const { CROSSFADE_TIME, PRE_START_TIME } = CrossfadeLooper

    // Fire early to pre-buffer the next audio
    const timeUntilPreStart =
      (fromAudio.duration -
        CROSSFADE_TIME -
        PRE_START_TIME -
        fromAudio.currentTime) *
      1000

    if (timeUntilPreStart <= 0) return

    this.crossfadeTimeout = setTimeout(
      () => {
        if (this.disposed || !this.isPlaying) return

        const toAudio = from === "a" ? this.audioB : this.audioA
        const fromGain = from === "a" ? this.gainA : this.gainB
        const toGain = from === "a" ? this.gainB : this.gainA

        // Pre-start next audio at gain 0 to avoid startup latency
        toGain.gain.setValueAtTime(0, this.ctx.currentTime)
        toAudio.currentTime = 0
        toAudio.play().catch(() => {})

        // Schedule equal-power crossfade after pre-start buffer
        const crossfadeStart = this.ctx.currentTime + PRE_START_TIME
        fromGain.gain.setValueCurveAtTime(
          CrossfadeLooper.fadeOutCurve.map((v) => v * this.volume),
          crossfadeStart,
          CROSSFADE_TIME,
        )
        toGain.gain.setValueCurveAtTime(
          CrossfadeLooper.fadeInCurve.map((v) => v * this.volume),
          crossfadeStart,
          CROSSFADE_TIME,
        )

        this.active = from === "a" ? "b" : "a"
      },
      Math.max(0, timeUntilPreStart),
    )
  }

  start() {
    if (this.disposed || this.isPlaying) return
    this.isPlaying = true

    const activeAudio = this.active === "a" ? this.audioA : this.audioB
    const activeGain = this.active === "a" ? this.gainA : this.gainB
    activeGain.gain.value = this.volume
    activeAudio.play().catch((err) => console.warn("Autoplay blocked:", err))
  }

  stop() {
    if (!this.isPlaying) return
    this.isPlaying = false
    this.clearCrossfadeTimeout()
    this.audioA.pause()
    this.audioB.pause()
  }

  setVolume(vol: number) {
    this.volume = vol
    // Only update the active gain node
    const activeGain = this.active === "a" ? this.gainA : this.gainB
    activeGain.gain.value = vol
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()

    this.audioA.removeEventListener("playing", this.handlePlayingA)
    this.audioB.removeEventListener("playing", this.handlePlayingB)
    this.audioA.src = ""
    this.audioB.src = ""
  }
}

type AudioStore = {
  getState: () => AudioState
  setState: (
    partial: Partial<AudioState> | ((state: AudioState) => Partial<AudioState>),
  ) => void
  subscribe: (listener: () => void) => () => void
}

function createStore(initial: AudioState): AudioStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState: (partial) => {
      const updates = typeof partial === "function" ? partial(state) : partial
      state = { ...state, ...updates }
      listeners.forEach((l) => l())
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

type AudioActions = {
  // Narrator actions
  enableNarrator: () => void
  disableNarrator: () => void
  setVoice: (voiceId: VoiceId) => void
  setNarratorSpeed: (speed: number) => void
  setNarratorVolume: (volume: number) => void

  // TTS playback actions
  loadBlockTTS: (blockId: string, chunkContent: string) => Promise<void>
  play: () => void
  pause: () => void
  togglePlayPause: () => void
  skip: (seconds: number) => void
  goToSegment: (index: number) => void

  // Music actions
  addTrack: (track: MusicTrack) => void
  removeTrack: (trackId: string) => void
  reorderTracks: (fromIndex: number, toIndex: number) => void
  setMusicVolume: (volume: number) => void
  setMusicShuffle: (shuffle: boolean) => void
  setMusicLoop: (loop: boolean) => void
  playMusic: () => void
  pauseMusic: () => void
  toggleMusicPlayPause: () => void
  nextTrack: () => void
  previousTrack: () => void

  // Ambience actions
  toggleAmbientSound: (soundId: AmbientSoundId, enabled: boolean) => void
  setAmbientVolume: (soundId: AmbientSoundId, volume: number) => void

  // Master actions
  setMasterVolume: (volume: number) => void
  setActivePreset: (presetId: string | null) => void
}

const AudioContext = createContext<{
  store: AudioStore
  actions: AudioActions
  audioRef: React.RefObject<HTMLAudioElement | null>
} | null>(null)

function createInitialState(): AudioState {
  return {
    narrator: {
      isEnabled: false,
      voice: "male_1",
      speed: 1.0,
      volume: 1.0,
    },
    playback: {
      isLoading: false,
      currentBlockId: null,
      error: null,
      segments: [],
      currentSegmentIndex: 0,
      isPlaying: false,
      isSynthesizing: false,
      totalDuration: 0,
      currentTime: 0,
      segmentCurrentTime: 0,
    },
    music: {
      playlist: [],
      currentTrackIndex: 0,
      isPlaying: false,
      volume: 0.25,
      shuffle: false,
      loop: true,
    },
    ambience: {
      sounds: AMBIENT_SOUNDS.map((sound) => ({
        id: sound.id,
        name: sound.name,
        src: sound.src,
        enabled: false,
        volume: 0.5,
      })),
    },
    master: {
      volume: 1.0,
      activePreset: null,
    },
  }
}

export function AudioProvider({
  documentId,
  children,
}: {
  documentId: string | null
  children: ReactNode
}) {
  const storeRef = useRef<AudioStore>(null!)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  // Web Audio API context for smooth crossfades
  const audioContextRef = useRef<AudioContext | null>(null)
  // CrossfadeLooper instances per ambient sound
  const ambienceAudioRefs = useRef<Map<string, CrossfadeLooper>>(new Map())
  // Track current music track ID to avoid unnecessary src changes
  const currentMusicTrackIdRef = useRef<string | null>(null)
  // Prevent duplicate initializations
  const pendingAmbienceInits = useRef(new Set<string>())
  // AbortController for canceling SSE stream
  const sseAbortRef = useRef<AbortController | null>(null)

  if (!storeRef.current) {
    storeRef.current = createStore(createInitialState())
  }
  const store = storeRef.current

  // Helper to safely play audio with autoplay policy handling
  const safePlay = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch((err) => {
      console.warn("Autoplay blocked:", err)
    })
  }, [])

  // Get or create AudioContext (lazily initialized)
  const getAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext()
    }
    const ctx = audioContextRef.current
    // Resume if suspended (browsers require user interaction)
    if (ctx.state === "suspended") {
      await ctx.resume()
    }
    return ctx
  }, [])

  // Play a specific segment
  const playSegment = useCallback(
    (segmentIndex: number) => {
      const state = store.getState()
      const segment = state.playback.segments[segmentIndex]
      if (!segment) return

      if (segment.status === "ready" && segment.audioUrl && audioRef.current) {
        store.setState({
          playback: { ...state.playback, currentSegmentIndex: segmentIndex },
        })
        audioRef.current.src = segment.audioUrl
        safePlay(audioRef.current)
        store.setState({
          playback: { ...store.getState().playback, isPlaying: true },
        })
      }
    },
    [store, safePlay],
  )

  // === Narrator Actions ===
  const enableNarrator = useCallback(() => {
    const state = store.getState()
    store.setState({
      narrator: { ...state.narrator, isEnabled: true },
      playback: { ...state.playback, error: null },
    })
  }, [store])

  const disableNarrator = useCallback(() => {
    // Cancel any ongoing SSE stream
    if (sseAbortRef.current) {
      sseAbortRef.current.abort()
      sseAbortRef.current = null
    }

    // Stop audio and cleanup
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }

    const state = store.getState()
    store.setState({
      narrator: { ...state.narrator, isEnabled: false },
      playback: {
        ...state.playback,
        segments: [],
        currentBlockId: null,
        error: null,
        isPlaying: false,
        isSynthesizing: false,
        currentSegmentIndex: 0,
        totalDuration: 0,
        currentTime: 0,
        segmentCurrentTime: 0,
      },
    })

    // Fire-and-forget: free GPU memory
    fetch("/api/tts/unload", { method: "POST" }).catch(() => {})
  }, [store])

  const setVoice = useCallback(
    (voiceId: VoiceId) => {
      const state = store.getState()
      if (state.narrator.voice === voiceId) return

      // Cancel any ongoing SSE stream
      if (sseAbortRef.current) {
        sseAbortRef.current.abort()
        sseAbortRef.current = null
      }

      // Stop current playback
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ""
      }

      // Clear all audio and reset to pending
      const resetSegments = state.playback.segments.map((s) => ({
        ...s,
        audioUrl: null,
        durationMs: null,
        status: "pending" as SegmentStatus,
      }))

      store.setState({
        narrator: { ...state.narrator, voice: voiceId },
        playback: {
          ...state.playback,
          segments: resetSegments,
          isPlaying: false,
          isSynthesizing: false,
          totalDuration: 0,
          currentTime: 0,
          segmentCurrentTime: 0,
        },
      })

      // Note: User needs to click again to re-trigger loadBlockTTS with new voice
      // This is simpler than auto-re-synthesizing and avoids wasted API calls
    },
    [store],
  )

  const setNarratorSpeed = useCallback(
    (speed: number) => {
      const state = store.getState()
      store.setState({
        narrator: { ...state.narrator, speed },
      })
    },
    [store],
  )

  const setNarratorVolume = useCallback(
    (volume: number) => {
      const state = store.getState()
      store.setState({
        narrator: { ...state.narrator, volume },
      })
      // Apply volume to audio element
      if (audioRef.current) {
        audioRef.current.volume = volume * state.master.volume
      }
    },
    [store],
  )

  // === TTS Playback Actions ===
  const loadBlockTTS = useCallback(
    async (blockId: string, chunkContent: string) => {
      if (!documentId) {
        const state = store.getState()
        store.setState({
          playback: {
            ...state.playback,
            error: "Document not saved - TTS requires a saved document",
          },
        })
        toast.error("Document not saved - TTS requires a saved document")
        return
      }

      // Cancel any ongoing SSE stream
      if (sseAbortRef.current) {
        sseAbortRef.current.abort()
        sseAbortRef.current = null
      }

      // Stop current playback if switching blocks
      const currentState = store.getState()
      if (currentState.playback.currentBlockId !== blockId) {
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ""
        }
        store.setState({
          playback: {
            ...currentState.playback,
            segments: [],
            isPlaying: false,
            currentSegmentIndex: 0,
            currentTime: 0,
            totalDuration: 0,
            segmentCurrentTime: 0,
          },
        })
      }

      store.setState({
        playback: {
          ...store.getState().playback,
          isLoading: true,
          error: null,
          currentBlockId: blockId,
        },
      })
      const toastId = toast.loading("Preparing text for speech...")

      try {
        // Step 1: Get segments via /tts/rewrite (may be cached)
        const rewriteResponse = await fetch("/api/tts/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ documentId, blockId, chunkContent }),
        })

        if (!rewriteResponse.ok) {
          const data = await rewriteResponse.json().catch(() => ({}))
          throw new Error(data.error || "Failed to prepare text")
        }

        const rewriteData = await rewriteResponse.json()

        // Initialize segments with pending status
        const segments: TTSSegment[] = rewriteData.segments.map(
          (s: Pick<TTSSegment, "index" | "text">) => ({
            index: s.index,
            text: s.text,
            audioUrl: null,
            durationMs: null,
            status: "pending" as SegmentStatus,
          }),
        )

        store.setState({
          playback: {
            ...store.getState().playback,
            segments,
            isLoading: false,
            isSynthesizing: true,
          },
        })
        toast.dismiss(toastId)

        if (segments.length === 0) {
          toast.error("No text to synthesize")
          store.setState({
            playback: { ...store.getState().playback, isSynthesizing: false },
          })
          return
        }

        toast.loading("Generating speech...", { id: "tts-synth" })

        // Step 2: Open SSE to /tts/chunk for ALL segments
        const abortController = new AbortController()
        sseAbortRef.current = abortController

        const chunkResponse = await fetch("/api/tts/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            documentId,
            blockId,
            voiceId: store.getState().narrator.voice,
          }),
          signal: abortController.signal,
        })

        if (!chunkResponse.ok) {
          const data = await chunkResponse.json().catch(() => ({}))
          throw new Error(data.error || "Failed to start synthesis")
        }

        const reader = chunkResponse.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let firstSegmentPlayed = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n\n")
          buffer = lines.pop() || "" // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const event = JSON.parse(line.slice(6))

            if (event.type === "segment") {
              const freshState = store.getState()
              const newSegments = [...freshState.playback.segments]
              newSegments[event.segmentIndex] = {
                ...newSegments[event.segmentIndex],
                audioUrl: event.audioUrl,
                durationMs: event.durationMs,
                status: "ready",
              }

              const totalDuration =
                newSegments.reduce((sum, s) => sum + (s.durationMs || 0), 0) /
                1000

              const stillSynthesizing = newSegments.some(
                (s) => s.status === "pending",
              )

              store.setState({
                playback: {
                  ...freshState.playback,
                  segments: newSegments,
                  totalDuration,
                  isSynthesizing: stillSynthesizing,
                },
              })

              // Auto-play first segment when it arrives
              if (!firstSegmentPlayed && event.segmentIndex === 0) {
                firstSegmentPlayed = true
                if (audioRef.current) {
                  audioRef.current.src = event.audioUrl
                  safePlay(audioRef.current)
                  store.setState({
                    playback: {
                      ...store.getState().playback,
                      isPlaying: true,
                      currentSegmentIndex: 0,
                    },
                  })
                }
                toast.success("Speech ready", { id: "tts-synth" })
              }
            } else if (event.type === "error") {
              const freshState = store.getState()
              const newSegments = [...freshState.playback.segments]
              newSegments[event.segmentIndex] = {
                ...newSegments[event.segmentIndex],
                status: "error",
              }
              store.setState({
                playback: { ...freshState.playback, segments: newSegments },
              })
              console.error(`Segment ${event.segmentIndex} failed:`, event.error)
            } else if (event.type === "done") {
              store.setState({
                playback: { ...store.getState().playback, isSynthesizing: false },
              })
            } else if (event.type === "fatal") {
              throw new Error(event.error)
            }
          }
        }

        sseAbortRef.current = null
      } catch (err) {
        // Ignore abort errors (user canceled)
        if (err instanceof Error && err.name === "AbortError") {
          return
        }

        const errorMsg =
          err instanceof Error ? err.message : "TTS processing failed"
        store.setState({
          playback: {
            ...store.getState().playback,
            error: errorMsg,
            isLoading: false,
            isSynthesizing: false,
          },
        })
        toast.error(errorMsg, { id: toastId })
      }
    },
    [store, documentId, safePlay],
  )

  const play = useCallback(() => {
    const state = store.getState()
    const segment = state.playback.segments[state.playback.currentSegmentIndex]
    if (audioRef.current && segment?.audioUrl) {
      safePlay(audioRef.current)
      store.setState({
        playback: { ...state.playback, isPlaying: true },
      })
    }
  }, [store, safePlay])

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      store.setState({
        playback: { ...store.getState().playback, isPlaying: false },
      })
    }
  }, [store])

  const togglePlayPause = useCallback(() => {
    if (store.getState().playback.isPlaying) {
      pause()
    } else {
      play()
    }
  }, [store, play, pause])

  const skip = useCallback(
    (seconds: number) => {
      const state = store.getState()
      if (!audioRef.current || state.playback.segments.length === 0) return

      // Calculate target time across all segments
      let targetTime = state.playback.currentTime + seconds
      targetTime = Math.max(
        0,
        Math.min(state.playback.totalDuration, targetTime),
      )

      // Find which segment this time falls into
      let accumulatedTime = 0
      for (let i = 0; i < state.playback.segments.length; i++) {
        const segmentDuration =
          (state.playback.segments[i].durationMs || 0) / 1000
        if (targetTime <= accumulatedTime + segmentDuration) {
          // Target is in this segment
          const segmentTime = targetTime - accumulatedTime
          if (i === state.playback.currentSegmentIndex) {
            // Same segment - just seek
            audioRef.current.currentTime = segmentTime
          } else {
            // Different segment - need to switch
            const segment = state.playback.segments[i]
            if (segment.status === "ready" && segment.audioUrl) {
              store.setState({
                playback: { ...state.playback, currentSegmentIndex: i },
              })
              audioRef.current.src = segment.audioUrl
              audioRef.current.currentTime = segmentTime
              if (state.playback.isPlaying) {
                safePlay(audioRef.current)
              }
            }
          }
          return
        }
        accumulatedTime += segmentDuration
      }
    },
    [store, safePlay],
  )

  const goToSegment = useCallback(
    (index: number) => {
      const state = store.getState()
      if (index < 0 || index >= state.playback.segments.length) return
      playSegment(index)
    },
    [store, playSegment],
  )

  // === Music Actions ===
  const addTrack = useCallback(
    (track: MusicTrack) => {
      const state = store.getState()
      if (state.music.playlist.some((t) => t.id === track.id)) return

      const wasEmpty = state.music.playlist.length === 0
      const newPlaylist = [...state.music.playlist, track]

      store.setState({
        music: {
          ...state.music,
          playlist: newPlaylist,
          // Auto-play if this is the first track with a valid src
          isPlaying:
            wasEmpty && track.src !== null ? true : state.music.isPlaying,
          currentTrackIndex: wasEmpty ? 0 : state.music.currentTrackIndex,
        },
      })
    },
    [store],
  )

  const removeTrack = useCallback(
    (trackId: string) => {
      const state = store.getState()
      const currentTrack = state.music.playlist[state.music.currentTrackIndex]
      const newPlaylist = state.music.playlist.filter((t) => t.id !== trackId)

      let newCurrentTrackIndex = state.music.currentTrackIndex
      let newIsPlaying = state.music.isPlaying

      if (trackId === currentTrack?.id) {
        // Removed the currently playing track
        if (newPlaylist.length === 0) {
          newCurrentTrackIndex = 0
          newIsPlaying = false
        } else {
          // Stay at same index (plays next track) or clamp to end
          newCurrentTrackIndex = Math.min(
            state.music.currentTrackIndex,
            newPlaylist.length - 1,
          )
        }
      } else if (currentTrack) {
        // Find new index of current track
        const newIndex = newPlaylist.findIndex((t) => t.id === currentTrack.id)
        newCurrentTrackIndex = newIndex === -1 ? 0 : newIndex
      }

      store.setState({
        music: {
          ...state.music,
          playlist: newPlaylist,
          currentTrackIndex: newCurrentTrackIndex,
          isPlaying: newIsPlaying,
        },
      })
    },
    [store],
  )

  const reorderTracks = useCallback(
    (fromIndex: number, toIndex: number) => {
      const state = store.getState()
      if (
        fromIndex < 0 ||
        fromIndex >= state.music.playlist.length ||
        toIndex < 0 ||
        toIndex >= state.music.playlist.length
      )
        return

      const currentTrackId =
        state.music.playlist[state.music.currentTrackIndex]?.id

      const newPlaylist = [...state.music.playlist]
      const [track] = newPlaylist.splice(fromIndex, 1)
      newPlaylist.splice(toIndex, 0, track)

      // Find new index of current track
      const newCurrentTrackIndex = currentTrackId
        ? newPlaylist.findIndex((t) => t.id === currentTrackId)
        : 0

      store.setState({
        music: {
          ...state.music,
          playlist: newPlaylist,
          currentTrackIndex:
            newCurrentTrackIndex === -1 ? 0 : newCurrentTrackIndex,
        },
      })
    },
    [store],
  )

  const setMusicVolume = useCallback(
    (volume: number) => {
      const state = store.getState()
      store.setState({
        music: { ...state.music, volume },
      })
      // Apply volume to music audio element
      if (musicAudioRef.current) {
        musicAudioRef.current.volume = volume * state.master.volume
      }
    },
    [store],
  )

  const setMusicShuffle = useCallback(
    (shuffle: boolean) => {
      const state = store.getState()
      store.setState({
        music: { ...state.music, shuffle },
      })
    },
    [store],
  )

  const setMusicLoop = useCallback(
    (loop: boolean) => {
      const state = store.getState()
      store.setState({
        music: { ...state.music, loop },
      })
    },
    [store],
  )

  const playMusic = useCallback(() => {
    const state = store.getState()
    if (state.music.playlist.length === 0) return
    store.setState({
      music: { ...state.music, isPlaying: true },
    })
  }, [store])

  const pauseMusic = useCallback(() => {
    const state = store.getState()
    store.setState({
      music: { ...state.music, isPlaying: false },
    })
  }, [store])

  const toggleMusicPlayPause = useCallback(() => {
    const state = store.getState()
    if (state.music.isPlaying) {
      pauseMusic()
    } else {
      playMusic()
    }
  }, [store, playMusic, pauseMusic])

  const nextTrack = useCallback(() => {
    const state = store.getState()
    if (state.music.playlist.length === 0) return

    const nextIndex =
      (state.music.currentTrackIndex + 1) % state.music.playlist.length
    store.setState({
      music: { ...state.music, currentTrackIndex: nextIndex },
    })
  }, [store])

  const previousTrack = useCallback(() => {
    const state = store.getState()
    if (state.music.playlist.length === 0) return

    const prevIndex =
      state.music.currentTrackIndex === 0
        ? state.music.playlist.length - 1
        : state.music.currentTrackIndex - 1
    store.setState({
      music: { ...state.music, currentTrackIndex: prevIndex },
    })
  }, [store])

  // === Ambience Actions ===
  const toggleAmbientSound = useCallback(
    (soundId: AmbientSoundId, enabled: boolean) => {
      const state = store.getState()
      const sound = state.ambience.sounds.find((s) => s.id === soundId)

      // Prevent enabling sounds without src
      if (enabled && !sound?.src) return

      store.setState({
        ambience: {
          sounds: state.ambience.sounds.map((s) =>
            s.id === soundId ? { ...s, enabled } : s,
          ),
        },
      })
    },
    [store],
  )

  const setAmbientVolume = useCallback(
    (soundId: AmbientSoundId, volume: number) => {
      const state = store.getState()
      store.setState({
        ambience: {
          sounds: state.ambience.sounds.map((s) =>
            s.id === soundId ? { ...s, volume } : s,
          ),
        },
      })
      // Apply volume to CrossfadeLooper
      const looper = ambienceAudioRefs.current.get(soundId)
      if (looper) {
        looper.setVolume(volume * state.master.volume)
      }
    },
    [store],
  )

  // === Master Actions ===
  const setMasterVolume = useCallback(
    (volume: number) => {
      const state = store.getState()
      store.setState({
        master: { ...state.master, volume },
      })
      // Apply master volume to all audio elements
      if (audioRef.current) {
        audioRef.current.volume = state.narrator.volume * volume
      }
      if (musicAudioRef.current) {
        musicAudioRef.current.volume = state.music.volume * volume
      }
      // Apply to all CrossfadeLoopers
      for (const [soundId, looper] of ambienceAudioRefs.current) {
        const sound = state.ambience.sounds.find((s) => s.id === soundId)
        if (sound) {
          looper.setVolume(sound.volume * volume)
        }
      }
    },
    [store],
  )

  const setActivePreset = useCallback(
    (presetId: string | null) => {
      const state = store.getState()
      store.setState({
        master: { ...state.master, activePreset: presetId },
      })
    },
    [store],
  )

  // === Effects for Audio Sync ===

  // Effect: Sync music playback with state
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()
      const audio = musicAudioRef.current
      if (!audio) return

      const currentTrack = state.music.playlist[state.music.currentTrackIndex]

      if (state.music.isPlaying && currentTrack?.src) {
        // Only change source if track actually changed
        if (currentMusicTrackIdRef.current !== currentTrack.id) {
          currentMusicTrackIdRef.current = currentTrack.id
          audio.src = currentTrack.src
        }
        audio.volume = state.music.volume * state.master.volume
        if (audio.paused) {
          safePlay(audio)
        }
      } else {
        if (!audio.paused) {
          audio.pause()
        }
      }
    })

    return unsubscribe
  }, [store, safePlay])

  // Effect: Handle music track ended
  useEffect(() => {
    const audio = musicAudioRef.current
    if (!audio) return

    const handleEnded = () => {
      const state = store.getState()
      const nextIndex = state.music.currentTrackIndex + 1

      if (nextIndex < state.music.playlist.length) {
        // Play next track
        store.setState({
          music: { ...state.music, currentTrackIndex: nextIndex },
        })
      } else if (state.music.loop) {
        // Loop back to beginning
        store.setState({
          music: { ...state.music, currentTrackIndex: 0 },
        })
      } else {
        // Stop at end
        store.setState({
          music: { ...state.music, isPlaying: false },
        })
      }
    }

    audio.addEventListener("ended", handleEnded)
    return () => audio.removeEventListener("ended", handleEnded)
  }, [store])

  // Effect: Sync ambience playback
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()

      for (const sound of state.ambience.sounds) {
        const looper = ambienceAudioRefs.current.get(sound.id)

        if (sound.enabled && sound.src) {
          if (!looper && !pendingAmbienceInits.current.has(sound.id)) {
            // Create new CrossfadeLooper
            pendingAmbienceInits.current.add(sound.id)
            const src = sound.src // Capture for closure
            getAudioContext().then((ctx) => {
              const vol = sound.volume * state.master.volume
              const newLooper = new CrossfadeLooper(ctx, src, vol)
              ambienceAudioRefs.current.set(sound.id, newLooper)
              newLooper.start()
              pendingAmbienceInits.current.delete(sound.id)
            })
          } else if (looper) {
            looper.start() // No-op if already playing
          }
        } else if (looper) {
          looper.stop()
        }
      }
    })

    return unsubscribe
  }, [store, getAudioContext])

  // Effect: Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any ongoing SSE stream
      if (sseAbortRef.current) {
        sseAbortRef.current.abort()
      }

      for (const looper of ambienceAudioRefs.current.values()) {
        looper.dispose()
      }
      ambienceAudioRefs.current.clear()
      // Close AudioContext if it exists
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [])

  // Set up TTS audio event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      const state = store.getState()
      const nextIndex = state.playback.currentSegmentIndex + 1

      if (nextIndex < state.playback.segments.length) {
        // Play next segment if ready
        const nextSegment = state.playback.segments[nextIndex]
        if (nextSegment.status === "ready" && nextSegment.audioUrl) {
          store.setState({
            playback: { ...state.playback, currentSegmentIndex: nextIndex },
          })
          audio.src = nextSegment.audioUrl
          safePlay(audio)
        } else {
          // Next segment not ready yet - pause and wait
          // (SSE will deliver it, then user can resume)
          store.setState({
            playback: {
              ...state.playback,
              currentSegmentIndex: nextIndex,
              isPlaying: false,
            },
          })
        }
      } else {
        // All segments finished
        store.setState({
          playback: {
            ...state.playback,
            isPlaying: false,
            segmentCurrentTime: 0,
          },
        })
      }
    }

    const handleTimeUpdate = () => {
      const state = store.getState()
      const segmentCurrentTime = audio.currentTime

      // Calculate total time = sum of previous segments + current position
      let previousDuration = 0
      for (let i = 0; i < state.playback.currentSegmentIndex; i++) {
        previousDuration += (state.playback.segments[i]?.durationMs || 0) / 1000
      }
      const currentTime = previousDuration + segmentCurrentTime

      store.setState({
        playback: { ...state.playback, currentTime, segmentCurrentTime },
      })
    }

    const handlePlay = () => {
      store.setState({
        playback: { ...store.getState().playback, isPlaying: true },
      })
    }

    const handlePause = () => {
      store.setState({
        playback: { ...store.getState().playback, isPlaying: false },
      })
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
  }, [store, safePlay])

  const valueRef = useRef<{
    store: AudioStore
    actions: AudioActions
    audioRef: React.RefObject<HTMLAudioElement | null>
  }>(null!)

  if (!valueRef.current) {
    valueRef.current = {
      store,
      actions: {} as AudioActions, // Populated below
      audioRef,
    }
  }

  // Update actions on each render to capture latest callbacks
  valueRef.current.actions = {
    enableNarrator,
    disableNarrator,
    setVoice,
    setNarratorSpeed,
    setNarratorVolume,
    loadBlockTTS,
    play,
    pause,
    togglePlayPause,
    skip,
    goToSegment,
    addTrack,
    removeTrack,
    reorderTracks,
    setMusicVolume,
    setMusicShuffle,
    setMusicLoop,
    playMusic,
    pauseMusic,
    toggleMusicPlayPause,
    nextTrack,
    previousTrack,
    toggleAmbientSound,
    setAmbientVolume,
    setMasterVolume,
    setActivePreset,
  }

  return (
    <AudioContext.Provider value={valueRef.current}>
      {/* Hidden audio elements */}
      <audio ref={audioRef} />
      <audio ref={musicAudioRef} />
      {children}
    </AudioContext.Provider>
  )
}

function useAudioContext() {
  const ctx = useContext(AudioContext)
  if (!ctx) throw new Error("Audio hooks must be used within AudioProvider")
  return ctx
}

export function useAudioSelector<T>(selector: (state: AudioState) => T): T {
  const { store } = useAudioContext()
  const [state, setState] = useState(() => selector(store.getState()))
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  useEffect(() => {
    // Only update if the selected value actually changed
    const checkForUpdates = () => {
      const newValue = selectorRef.current(store.getState())
      setState((prev) => (Object.is(prev, newValue) ? prev : newValue))
    }
    // Check immediately in case state changed between render and effect
    checkForUpdates()
    return store.subscribe(checkForUpdates)
  }, [store])

  return state
}

export function useAudioActions(): AudioActions {
  return useAudioContext().actions
}

export function useAudioRef(): React.RefObject<HTMLAudioElement | null> {
  return useAudioContext().audioRef
}
