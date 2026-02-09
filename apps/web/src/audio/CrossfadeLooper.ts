export class CrossfadeLooper {
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
