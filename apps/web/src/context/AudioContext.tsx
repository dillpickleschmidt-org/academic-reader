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
import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id } from "@academic-reader/convex/convex/_generated/dataModel"
import { Effect, Fiber, Option, Stream } from "effect"
import { Headers } from "@effect/platform"
import { Sse } from "@effect/experimental"
import {
  synthesizeTTS,
  prefetchTTS,
  batchTTS,
  unloadTTS,
} from "@academic-reader/api-client/client"
import { AppRuntime } from "@/lib/runtime"
import type {
  AudioState,
  VoiceId,
  MusicTrack,
  AmbientSoundId,
} from "@/audio/types"
import type { ChunkBlock } from "@academic-reader/api-client/schemas/document"
import { AMBIENT_SOUNDS } from "@/audio/constants"
import { UnifiedAudioPlayer } from "@/audio/UnifiedAudioPlayer"
import { CrossfadeLooper } from "@/audio/CrossfadeLooper"
import { useDocumentContext } from "@/context/DocumentContext"

const backendMode = import.meta.env.VITE_BACKEND_MODE

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
  setVoice: (voiceId: VoiceId) => void
  setNarratorSpeed: (speed: number) => void
  setNarratorVolume: (volume: number) => void

  // TTS playback actions
  loadBlockTTS: (
    blockId: string,
    options?: { wordIndex?: number; seekToSeconds?: number; seekFromEndSeconds?: number },
  ) => Promise<void>
  play: () => void
  pause: () => void
  togglePlayPause: () => void
  skip: (seconds: number) => void
  seekToWord: (wordIndex: number) => void

  // Batch TTS actions
  processDocument: (targetBlockId: string, wordIndex?: number) => void

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
  getPlaybackTime: () => number
} | null>(null)

function createInitialState(): AudioState {
  return {
    narrator: {
      voice: "female_1",
      speed: 1.0,
      volume: 1.0,
    },
    playback: {
      mode: "idle",
      blockId: null,
      error: null,
      text: null,
      durationMs: 0,
      currentTime: 0,
      isPlaying: false,
      canPause: false,
      canSeek: false,
      wordTimestamps: [],
    },
    music: {
      playlist: [],
      currentTrackIndex: 0,
      isPlaying: false,
      volume: 0.35,
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
    batchStarted: false,
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
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const ambienceAudioRefs = useRef<Map<string, CrossfadeLooper>>(new Map())
  const currentMusicTrackIdRef = useRef<string | null>(null)
  const pendingAmbienceInits = useRef(new Set<string>())
  // Effect fiber refs replace AbortController refs
  const sseFiberRef = useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
  const playerRef = useRef<UnifiedAudioPlayer | null>(null)
  const prefetchFiberRef = useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
  const synthInFlightRef = useRef(new Map<string, Promise<void>>())
  const batchFiberRef = useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
  const batchProcessingRef = useRef(false)
  const [batchTarget, setBatchTarget] = useState<{
    documentId: string
    blockId: string
    voiceId: string
    wordIndex?: number
  } | null>(null)
  const [activeVoice, setActiveVoice] = useState("female_1")
  const chunksRef = useRef<ChunkBlock[] | undefined>(undefined)
  const loadBlockTTSRef = useRef<(blockId: string, options?: { wordIndex?: number; seekToSeconds?: number; seekFromEndSeconds?: number }) => Promise<void>>(null!)

  if (!storeRef.current) {
    storeRef.current = createStore(createInitialState())
  }
  const store = storeRef.current

  const safePlay = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch((err) => {
      console.warn("Autoplay blocked:", err)
    })
  }, [])

  const getAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext()
    }
    const ctx = audioContextRef.current
    if (ctx.state === "suspended") {
      await ctx.resume()
    }
    return ctx
  }, [])

  const cleanupPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.dispose()
      playerRef.current = null
    }
  }, [])

  const docContext = useDocumentContext()
  chunksRef.current = docContext?.chunks

  const ttsMapRef = useRef<Map<string, boolean> | undefined>(undefined)
  ttsMapRef.current = docContext?.ttsMap

  const ttsTextMapRef = useRef<Map<string, string> | undefined>(undefined)
  ttsTextMapRef.current = docContext?.ttsTextMap

  const findNextTtsBlock = useCallback(
    (chunks: ChunkBlock[], currentBlockId: string): ChunkBlock | null => {
      const currentIndex = chunks.findIndex((c) => c.id === currentBlockId)
      if (currentIndex === -1) return null

      const map = ttsMapRef.current
      for (let i = currentIndex + 1; i < chunks.length; i++) {
        if (map ? map.get(chunks[i].id) : chunks[i].includeTts) return chunks[i]
      }
      return null
    },
    [],
  )

  const findPreviousTtsBlock = useCallback(
    (chunks: ChunkBlock[], currentBlockId: string): ChunkBlock | null => {
      const currentIndex = chunks.findIndex((c) => c.id === currentBlockId)
      if (currentIndex === -1) return null

      const map = ttsMapRef.current
      for (let i = currentIndex - 1; i >= 0; i--) {
        if (map ? map.get(chunks[i].id) : chunks[i].includeTts) return chunks[i]
      }
      return null
    },
    [],
  )

  const prefetchNextBlock = useCallback(
    (currentBlockId: string, voiceId: string) => {
      const chunks = docContext?.chunks
      if (!chunks || !documentId) return

      const nextBlock = findNextTtsBlock(chunks, currentBlockId)
      if (!nextBlock) return

      const ttsText = ttsTextMapRef.current?.get(nextBlock.id)
      if (!ttsText) return

      const key = `${nextBlock.id}:${voiceId}`
      if (synthInFlightRef.current.has(key)) return

      if (prefetchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(prefetchFiberRef.current))
      }

      let resolveInFlight!: () => void
      const promise = new Promise<void>((r) => {
        resolveInFlight = r
      })
      synthInFlightRef.current.set(key, promise)

      prefetchFiberRef.current = AppRuntime.runFork(
        prefetchTTS({
          documentId,
          blockId: nextBlock.id,
          ttsText,
          voiceId,
        }).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.ensuring(Effect.sync(() => {
            synthInFlightRef.current.delete(key)
            resolveInFlight()
          })),
        ),
      )
    },
    [documentId, docContext?.chunks, findNextTtsBlock],
  )

  // === Batch TTS: Convex subscription for target block readiness ===
  const targetBlockAudio = useQuery(
    api.api.ttsAudio.getBlockAudio,
    batchTarget
      ? {
          documentId: batchTarget.documentId as Id<"documents">,
          blockId: batchTarget.blockId,
          voiceId: batchTarget.voiceId,
        }
      : "skip",
  )

  useEffect(() => {
    if (!batchTarget || !targetBlockAudio) return

    const chunks = chunksRef.current
    const block = chunks?.find((c) => c.id === batchTarget.blockId)
    if (!block) return

    const { wordIndex } = batchTarget
    setBatchTarget(null)
    loadBlockTTSRef.current(
      block.id,
      wordIndex !== undefined ? { wordIndex } : undefined,
    )
  }, [targetBlockAudio, batchTarget])

  // === Batch TTS: Detect existing audio across sessions ===
  const hasExistingAudio = useQuery(
    api.api.ttsAudio.hasDocumentAudio,
    documentId
      ? { documentId: documentId as Id<"documents">, voiceId: activeVoice }
      : "skip",
  )

  useEffect(() => {
    if (hasExistingAudio) {
      store.setState({ batchStarted: true })
    }
  }, [hasExistingAudio, store])

  // === Narrator Actions ===
  const setVoice = useCallback(
    (voiceId: VoiceId) => {
      const state = store.getState()
      if (state.narrator.voice === voiceId) return

      if (sseFiberRef.current) {
        Effect.runFork(Fiber.interrupt(sseFiberRef.current))
        sseFiberRef.current = null
      }
      if (prefetchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(prefetchFiberRef.current))
        prefetchFiberRef.current = null
      }
      synthInFlightRef.current.clear()
      if (batchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(batchFiberRef.current))
        batchFiberRef.current = null
      }
      setBatchTarget(null)
      setActiveVoice(voiceId)

      cleanupPlayer()

      store.setState({
        narrator: { ...state.narrator, voice: voiceId },
        playback: {
          ...state.playback,
          mode: "idle",
          durationMs: 0,
          wordTimestamps: [],
          isPlaying: false,
          canPause: false,
          canSeek: false,
          currentTime: 0,
        },
        batchStarted: false,
      })
      batchProcessingRef.current = false
    },
    [store, cleanupPlayer],
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
      if (playerRef.current) {
        playerRef.current.setVolume(volume * state.master.volume)
      }
    },
    [store],
  )

  const createPlayerCallbacks = useCallback(() => ({
    onModeChange: (mode: "idle" | "streaming" | "ready") => {
      const playback = store.getState().playback
      const hasControls = mode === "streaming" || mode === "ready"
      store.setState({
        playback: {
          ...playback,
          mode: mode === "idle" ? "idle" : mode,
          canPause: hasControls,
          canSeek: hasControls,
        },
      })
    },
    onPlayingChange: (isPlaying: boolean) => {
      store.setState({
        playback: { ...store.getState().playback, isPlaying },
      })
    },
    onTimeUpdate: (currentTime: number, duration: number) => {
      store.setState({
        playback: {
          ...store.getState().playback,
          currentTime,
          durationMs: Math.round(duration * 1000),
        },
      })
    },
    onEnded: () => {
      const chunks = chunksRef.current
      const { blockId } = store.getState().playback

      if (chunks && blockId) {
        const nextBlock = findNextTtsBlock(chunks, blockId)
        if (nextBlock) {
          loadBlockTTSRef.current(nextBlock.id)
          return
        }
      }

      store.setState({
        playback: {
          ...store.getState().playback,
          isPlaying: false,
          currentTime: 0,
        },
      })
    },
  }), [store, findNextTtsBlock])

  // === TTS Playback Actions ===
  const loadBlockTTS = useCallback(
    async (blockId: string, options?: { wordIndex?: number; seekToSeconds?: number; seekFromEndSeconds?: number }) => {
      const { wordIndex, seekToSeconds, seekFromEndSeconds } = options || {}

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

      const ttsText = ttsTextMapRef.current?.get(blockId)

      const voiceId = store.getState().narrator.voice
      const inFlightKey = `${blockId}:${voiceId}`

      // Cancel previous synthesis fiber
      if (sseFiberRef.current) {
        Effect.runFork(Fiber.interrupt(sseFiberRef.current))
        sseFiberRef.current = null
      }
      cleanupPlayer()

      store.setState({
        playback: {
          ...store.getState().playback,
          mode: "loading",
          error: null,
          blockId,
          text: null,
          durationMs: 0,
          wordTimestamps: [],
          isPlaying: false,
          canPause: false,
          canSeek: false,
          currentTime: 0,
        },
      })

      // Wait for in-flight prefetch if one exists for this block
      const inFlight = synthInFlightRef.current.get(inFlightKey)
      if (inFlight) {
        await inFlight
      }

      const toastId = toast.loading("Preparing speech...")

      let resolveInFlight!: () => void
      const inFlightPromise = new Promise<void>((r) => {
        resolveInFlight = r
      })
      synthInFlightRef.current.set(inFlightKey, inFlightPromise)

      // Fork the Effect synthesis program
      sseFiberRef.current = AppRuntime.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const response = yield* synthesizeTTS({
              documentId,
              blockId,
              ...(ttsText && { ttsText }),
              voiceId,
            })

            const contentType = Option.getOrElse(
              Headers.get(response.headers, "content-type"),
              () => "",
            )

            if (contentType.includes("application/json")) {
              // Cached response - direct JSON with audio URL
              const data = (yield* response.json) as {
                audioUrl: string
                text: string
                durationMs: number
                wordTimestamps?: Array<{ word: string; startMs: number; endMs: number }>
              }

              const ctx = yield* Effect.promise(getAudioContext)
              const state = store.getState()
              cleanupPlayer()
              playerRef.current = new UnifiedAudioPlayer(
                ctx,
                state.narrator.volume * state.master.volume,
                createPlayerCallbacks(),
              )

              yield* Effect.promise(() => playerRef.current!.loadFromUrl(data.audioUrl))

              store.setState({
                playback: {
                  ...store.getState().playback,
                  mode: "ready",
                  text: data.text,
                  durationMs: data.durationMs,
                  wordTimestamps: data.wordTimestamps || [],
                  canPause: true,
                  canSeek: true,
                },
              })

              if (seekToSeconds !== undefined) {
                playerRef.current.seek(seekToSeconds)
              } else if (seekFromEndSeconds !== undefined) {
                const dur = playerRef.current.getDuration()
                playerRef.current.seek(Math.max(0, dur - seekFromEndSeconds))
              } else if (wordIndex !== undefined && wordIndex >= 0 && data.wordTimestamps?.length) {
                const timestamp = data.wordTimestamps[Math.min(wordIndex, data.wordTimestamps.length - 1)]
                if (timestamp) {
                  playerRef.current.seek(timestamp.startMs / 1000)
                }
              }

              playerRef.current.play()
              toast.success("Speech ready", { id: toastId })

              prefetchNextBlock(blockId, store.getState().narrator.voice)
              return
            }

            // SSE stream for non-cached synthesis with streaming audio
            const ctx = yield* Effect.promise(getAudioContext)
            const state = store.getState()
            cleanupPlayer()
            playerRef.current = new UnifiedAudioPlayer(
              ctx,
              state.narrator.volume * state.master.volume,
              createPlayerCallbacks(),
            )
            playerRef.current.startStreaming()

            const decoder = new TextDecoder()
            let firstChunk = true

            yield* response.stream.pipe(
              Stream.map((bytes) => decoder.decode(bytes, { stream: true })),
              Stream.pipeThroughChannel(Sse.makeChannel()),
              Stream.runForEach((sseEvent) =>
                Effect.sync(() => {
                  const event = JSON.parse(sseEvent.data)

                  if (event.type === "progress") {
                    toast.loading(
                      event.stage === "rewriting" ? "Preparing text..." : "Generating speech...",
                      { id: toastId },
                    )
                  } else if (event.type === "text") {
                    store.setState({
                      playback: { ...store.getState().playback, text: event.text },
                    })
                  } else if (event.type === "audio-chunk") {
                    if (firstChunk) {
                      toast.success("Speech ready", { id: toastId })
                      firstChunk = false

                      if (backendMode !== "local") {
                        prefetchNextBlock(blockId, store.getState().narrator.voice)
                      }
                    }
                    playerRef.current?.addPcmChunk(event.data)
                  } else if (event.type === "timestamps") {
                    store.setState({
                      playback: { ...store.getState().playback, wordTimestamps: event.wordTimestamps },
                    })
                  } else if (event.type === "complete") {
                    playerRef.current?.finishStreaming()

                    if (backendMode === "local") {
                      AppRuntime.runFork(
                        unloadTTS().pipe(
                          Effect.catchAll(() => Effect.void),
                          Effect.ensuring(Effect.sync(() =>
                            prefetchNextBlock(blockId, store.getState().narrator.voice),
                          )),
                        ),
                      )
                    }
                  } else if (event.type === "error") {
                    throw new Error(event.error)
                  }
                }),
              ),
            )

            sseFiberRef.current = null
          }),
        ).pipe(
          Effect.catchAll((err) =>
            Effect.sync(() => {
              console.error("[TTS] Streaming error:", err)
              cleanupPlayer()
              const errorMsg = err instanceof Error ? err.message : "TTS processing failed"
              store.setState({
                playback: {
                  ...store.getState().playback,
                  error: errorMsg,
                  mode: "idle",
                  isPlaying: false,
                  canPause: false,
                  canSeek: false,
                },
              })
              toast.error(errorMsg, { id: toastId })
            }),
          ),
          Effect.ensuring(Effect.sync(() => {
            synthInFlightRef.current.delete(inFlightKey)
            resolveInFlight()
          })),
        ),
      )
    },
    [store, documentId, getAudioContext, cleanupPlayer, createPlayerCallbacks, prefetchNextBlock],
  )
  loadBlockTTSRef.current = loadBlockTTS

  const processDocument = useCallback(
    (targetBlockId: string, wordIndex?: number) => {
      if (!documentId) {
        toast.error("Document not saved - TTS requires a saved document")
        return
      }

      const chunks = chunksRef.current
      const ttsMap = ttsMapRef.current
      const ttsTextMap = ttsTextMapRef.current
      if (!chunks) return

      const voiceId = store.getState().narrator.voice

      setBatchTarget({ documentId, blockId: targetBlockId, voiceId, wordIndex })
      store.setState({
        playback: {
          ...store.getState().playback,
          mode: "loading",
          blockId: targetBlockId,
          error: null,
          text: null,
          durationMs: 0,
          wordTimestamps: [],
          isPlaying: false,
          canPause: false,
          canSeek: false,
          currentTime: 0,
        },
      })

      if (batchProcessingRef.current) return

      const ttsEligible = chunks.filter((c) =>
        ttsMap ? ttsMap.get(c.id) : c.includeTts,
      )

      const blocks: Array<{ blockId: string; ttsText: string }> = []
      for (const c of ttsEligible) {
        const text = ttsTextMap?.get(c.id)
        if (text) blocks.push({ blockId: c.id, ttsText: text })
      }

      if (!blocks.length) return

      batchProcessingRef.current = true
      store.setState({ batchStarted: true })

      if (batchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(batchFiberRef.current))
      }

      batchFiberRef.current = AppRuntime.runFork(
        batchTTS({ documentId, voiceId, blocks }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              batchProcessingRef.current = false
            }),
          ),
          Effect.catchAll((err) =>
            Effect.sync(() => {
              batchProcessingRef.current = false
              store.setState({ batchStarted: false })
              toast.error(err instanceof Error ? err.message : "Batch processing failed")
            }),
          ),
        ),
      )
    },
    [documentId, store],
  )

  const play = useCallback(() => {
    playerRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    playerRef.current?.pause()
  }, [])

  const togglePlayPause = useCallback(() => {
    if (store.getState().playback.isPlaying) {
      pause()
    } else {
      play()
    }
  }, [store, play, pause])

  const skip = useCallback(
    (seconds: number) => {
      if (!playerRef.current?.canSeek) return
      const currentTime = playerRef.current.getCurrentTime()
      const duration = playerRef.current.getDuration()
      const targetTime = currentTime + seconds

      if (targetTime >= 0 && targetTime <= duration) {
        playerRef.current.seek(targetTime)
        return
      }

      const chunks = chunksRef.current
      const blockId = store.getState().playback.blockId
      if (!chunks || !blockId) {
        playerRef.current.seek(Math.max(0, Math.min(duration, targetTime)))
        return
      }

      if (targetTime < 0) {
        const prevBlock = findPreviousTtsBlock(chunks, blockId)
        if (!prevBlock) {
          playerRef.current.seek(0)
          return
        }
        loadBlockTTSRef.current(prevBlock.id, {
          seekFromEndSeconds: Math.abs(targetTime),
        })
      } else {
        const nextBlock = findNextTtsBlock(chunks, blockId)
        if (!nextBlock) {
          playerRef.current.seek(duration)
          return
        }
        loadBlockTTSRef.current(nextBlock.id, {
          seekToSeconds: targetTime - duration,
        })
      }
    },
    [store, findNextTtsBlock, findPreviousTtsBlock],
  )

  const seekToWord = useCallback(
    (wordIndex: number) => {
      const state = store.getState()
      if (!playerRef.current?.canSeek || !state.playback.wordTimestamps.length) return

      const timestamp = state.playback.wordTimestamps[Math.min(wordIndex, state.playback.wordTimestamps.length - 1)]
      if (timestamp) {
        playerRef.current.seek(timestamp.startMs / 1000)
      }
    },
    [store],
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
        if (newPlaylist.length === 0) {
          newCurrentTrackIndex = 0
          newIsPlaying = false
        } else {
          newCurrentTrackIndex = Math.min(
            state.music.currentTrackIndex,
            newPlaylist.length - 1,
          )
        }
      } else if (currentTrack) {
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
      if (playerRef.current) {
        playerRef.current.setVolume(state.narrator.volume * volume)
      }
      if (musicAudioRef.current) {
        musicAudioRef.current.volume = state.music.volume * volume
      }
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

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()
      const audio = musicAudioRef.current
      if (!audio) return

      const currentTrack = state.music.playlist[state.music.currentTrackIndex]

      if (state.music.isPlaying && currentTrack?.src) {
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

  useEffect(() => {
    const audio = musicAudioRef.current
    if (!audio) return

    const handleEnded = () => {
      const state = store.getState()
      const nextIndex = state.music.currentTrackIndex + 1

      if (nextIndex < state.music.playlist.length) {
        store.setState({
          music: { ...state.music, currentTrackIndex: nextIndex },
        })
      } else if (state.music.loop) {
        store.setState({
          music: { ...state.music, currentTrackIndex: 0 },
        })
      } else {
        store.setState({
          music: { ...state.music, isPlaying: false },
        })
      }
    }

    audio.addEventListener("ended", handleEnded)
    return () => audio.removeEventListener("ended", handleEnded)
  }, [store])

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()

      for (const sound of state.ambience.sounds) {
        const looper = ambienceAudioRefs.current.get(sound.id)

        if (sound.enabled && sound.src) {
          if (!looper && !pendingAmbienceInits.current.has(sound.id)) {
            pendingAmbienceInits.current.add(sound.id)
            const src = sound.src
            getAudioContext().then((ctx) => {
              const vol = sound.volume * state.master.volume
              const newLooper = new CrossfadeLooper(ctx, src, vol)
              ambienceAudioRefs.current.set(sound.id, newLooper)
              newLooper.start()
              pendingAmbienceInits.current.delete(sound.id)
            })
          } else if (looper) {
            looper.start()
          }
        } else if (looper) {
          looper.stop()
        }
      }
    })

    return unsubscribe
  }, [store, getAudioContext])

  useEffect(() => {
    return () => {
      if (prefetchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(prefetchFiberRef.current))
        prefetchFiberRef.current = null
      }
    }
  }, [documentId])

  useEffect(() => {
    return () => {
      if (sseFiberRef.current) {
        Effect.runFork(Fiber.interrupt(sseFiberRef.current))
      }
      if (prefetchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(prefetchFiberRef.current))
      }
      if (batchFiberRef.current) {
        Effect.runFork(Fiber.interrupt(batchFiberRef.current))
      }
      if (playerRef.current) {
        playerRef.current.dispose()
      }
      for (const looper of ambienceAudioRefs.current.values()) {
        looper.dispose()
      }
      ambienceAudioRefs.current.clear()
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [])

  const valueRef = useRef<{
    store: AudioStore
    actions: AudioActions
    getPlaybackTime: () => number
  }>(null!)

  if (!valueRef.current) {
    valueRef.current = {
      store,
      actions: {} as AudioActions,
      getPlaybackTime: () => playerRef.current?.getCurrentTime() ?? 0,
    }
  }

  valueRef.current.actions = {
    setVoice,
    setNarratorSpeed,
    setNarratorVolume,
    loadBlockTTS,
    processDocument,
    play,
    pause,
    togglePlayPause,
    skip,
    seekToWord,
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
      {/* Hidden audio element for music playback */}
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

  useEffect(() => {
    selectorRef.current = selector
  })

  useEffect(() => {
    const checkForUpdates = () => {
      const newValue = selectorRef.current(store.getState())
      setState((prev) => (Object.is(prev, newValue) ? prev : newValue))
    }
    checkForUpdates()
    return store.subscribe(checkForUpdates)
  }, [store])

  return state
}

export function useAudioActions(): AudioActions {
  return useAudioContext().actions
}

export function useGetPlaybackTime(): () => number {
  return useAudioContext().getPlaybackTime
}
