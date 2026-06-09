type PlayerMode = "idle" | "ready"

type UnifiedPlayerCallbacks = {
  onModeChange: (mode: PlayerMode) => void
  onPlayingChange: (isPlaying: boolean) => void
  onTimeUpdate: (currentTime: number, duration: number) => void
  onEnded: () => void
}

export class UnifiedAudioPlayer {
  private ctx: AudioContext
  private gainNode: GainNode
  private buffer: AudioBuffer | null = null
  private activeSource: AudioBufferSourceNode | null = null
  private playbackRate = 1
  private startTime = 0
  private pausePosition = 0
  private timeUpdateInterval: ReturnType<typeof setInterval> | null = null
  private callbacks: UnifiedPlayerCallbacks

  mode: PlayerMode = "idle"
  isPlaying = false

  constructor(
    ctx: AudioContext,
    volume: number,
    callbacks: UnifiedPlayerCallbacks,
  ) {
    this.ctx = ctx
    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = volume
    this.gainNode.connect(ctx.destination)
    this.callbacks = callbacks
  }

  async loadFromUrl(url: string): Promise<void> {
    this.stop()

    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()

    this.buffer = parseWavToBuffer(this.ctx, arrayBuffer)
    this.pausePosition = 0
    this.setMode("ready")
  }

  play(): void {
    if (this.isPlaying || this.mode !== "ready" || !this.buffer) return

    this.activeSource = this.createSource(this.buffer)
    this.activeSource.onended = this.handlePlaybackEnded
    this.activeSource.start(0, this.pausePosition)
    this.startTime = this.ctx.currentTime - this.pausePosition / this.playbackRate
    this.isPlaying = true
    this.callbacks.onPlayingChange(true)
    this.startTimeUpdates()
  }

  pause(): void {
    if (!this.isPlaying || this.mode !== "ready") return

    this.pausePosition = this.getCurrentTime()
    if (this.buffer) {
      this.pausePosition = Math.max(
        0,
        Math.min(this.pausePosition, this.buffer.duration),
      )
    }

    if (this.activeSource) {
      this.activeSource.onended = null
      this.activeSource.stop()
      this.activeSource = null
    }

    this.isPlaying = false
    this.callbacks.onPlayingChange(false)
    this.stopTimeUpdates()
  }

  stop(): void {
    this.stopTimeUpdates()

    if (this.activeSource) {
      try {
        this.activeSource.onended = null
        this.activeSource.stop()
      } catch {}
      this.activeSource = null
    }

    this.buffer = null
    this.isPlaying = false
    this.pausePosition = 0
    this.startTime = 0
    this.setMode("idle")
    this.callbacks.onPlayingChange(false)
  }

  seek(seconds: number): void {
    if (this.mode !== "ready" || !this.buffer) return

    const targetTime = Math.max(0, Math.min(seconds, this.buffer.duration))

    if (this.isPlaying) {
      if (this.activeSource) {
        this.activeSource.onended = null
        this.activeSource.stop()
      }

      this.activeSource = this.createSource(this.buffer)
      this.activeSource.onended = this.handlePlaybackEnded
      this.activeSource.start(0, targetTime)
      this.startTime = this.ctx.currentTime - targetTime / this.playbackRate
    } else {
      this.pausePosition = targetTime
    }

    this.callbacks.onTimeUpdate(targetTime, this.getDuration())
  }

  getCurrentTime(): number {
    if (this.mode === "idle") return 0
    if (!this.isPlaying || this.startTime === 0) return this.pausePosition
    return Math.max(0, (this.ctx.currentTime - this.startTime) * this.playbackRate)
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0
  }

  setVolume(vol: number): void {
    this.gainNode.gain.value = vol
  }

  setPlaybackRate(rate: number): void {
    const nextRate = Math.max(0.5, Math.min(2, rate))
    if (nextRate === this.playbackRate) return

    const currentTime = this.getCurrentTime()
    this.playbackRate = nextRate

    if (!this.isPlaying || this.mode !== "ready" || !this.buffer) {
      this.pausePosition = currentTime
      return
    }

    if (this.activeSource) {
      try {
        this.activeSource.onended = null
        this.activeSource.stop()
      } catch {}
    }

    const targetTime = Math.min(currentTime, this.buffer.duration)
    this.activeSource = this.createSource(this.buffer)
    this.activeSource.onended = this.handlePlaybackEnded
    this.activeSource.start(0, targetTime)
    this.startTime = this.ctx.currentTime - targetTime / this.playbackRate
  }

  get canSeek(): boolean {
    return this.mode === "ready"
  }

  dispose(): void {
    this.stop()
    this.gainNode.disconnect()
  }

  private setMode(mode: PlayerMode): void {
    if (this.mode !== mode) {
      this.mode = mode
      this.callbacks.onModeChange(mode)
    }
  }

  private handlePlaybackEnded = () => {
    if (!this.isPlaying || this.mode !== "ready" || !this.buffer) return

    const currentPos = this.getCurrentTime()
    if (currentPos < this.buffer.duration - 0.1) return

    this.isPlaying = false
    this.pausePosition = 0
    this.activeSource = null
    this.callbacks.onPlayingChange(false)
    this.callbacks.onEnded()
    this.stopTimeUpdates()
  }

  private createSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = this.playbackRate
    source.connect(this.gainNode)
    return source
  }

  private startTimeUpdates(): void {
    this.stopTimeUpdates()
    this.timeUpdateInterval = setInterval(() => {
      this.callbacks.onTimeUpdate(this.getCurrentTime(), this.getDuration())
    }, 100)
  }

  private stopTimeUpdates(): void {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval)
      this.timeUpdateInterval = null
    }
  }
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768
  }
  return float32
}

function parseWavToBuffer(
  ctx: AudioContext,
  arrayBuffer: ArrayBuffer,
): AudioBuffer {
  const view = new DataView(arrayBuffer)
  const sampleRate = view.getUint32(24, true)
  const pcmData = new Int16Array(arrayBuffer, 44)
  const floatData = int16ToFloat32(pcmData)
  const buffer = ctx.createBuffer(1, floatData.length, sampleRate)
  buffer.getChannelData(0).set(floatData)
  return buffer
}
