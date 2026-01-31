export type PlayerMode = "idle" | "streaming" | "ready"

export type UnifiedPlayerCallbacks = {
  onModeChange: (mode: PlayerMode) => void
  onPlayingChange: (isPlaying: boolean) => void
  onTimeUpdate: (currentTime: number, duration: number) => void
  onEnded: () => void
}

export class UnifiedAudioPlayer {
  private ctx: AudioContext
  private gainNode: GainNode

  // Complete buffer (for cached or completed streaming)
  private buffer: AudioBuffer | null = null
  private activeSource: AudioBufferSourceNode | null = null
  private playbackStartTime = 0 // ctx.currentTime when play() called
  private pausePosition = 0 // position in seconds when paused

  // Streaming state
  private streamingChunks: Float32Array[] = []
  private streamingSources: AudioBufferSourceNode[] = []
  private nextScheduleTime = 0
  private streamingStartTime = 0

  // Public state
  mode: PlayerMode = "idle"
  isPlaying = false

  // Time update interval
  private timeUpdateInterval: ReturnType<typeof setInterval> | null = null

  // Callbacks
  private callbacks: UnifiedPlayerCallbacks

  constructor(ctx: AudioContext, volume: number, callbacks: UnifiedPlayerCallbacks) {
    this.ctx = ctx
    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = volume
    this.gainNode.connect(ctx.destination)
    this.callbacks = callbacks
  }

  // === Cached Audio ===
  async loadFromUrl(url: string): Promise<void> {
    this.stop()
    this.setMode("idle")

    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer)

    this.pausePosition = 0
    this.setMode("ready")
  }

  // === Streaming Audio ===
  startStreaming(): void {
    this.stop()
    this.streamingChunks = []
    this.streamingSources = []
    this.nextScheduleTime = 0
    this.streamingStartTime = 0
    this.setMode("streaming")
    this.startTimeUpdates()
  }

  addPcmChunk(pcmBase64: string): void {
    if (this.mode !== "streaming") return

    const pcmData = base64ToInt16Array(pcmBase64)
    const floatData = int16ToFloat32(pcmData)

    // Store chunk for later consolidation
    this.streamingChunks.push(floatData)

    // Create and schedule audio buffer
    const audioBuffer = this.ctx.createBuffer(1, floatData.length, 24000)
    audioBuffer.getChannelData(0).set(floatData)

    const source = this.ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.gainNode)

    // Schedule seamlessly after previous chunk
    const startTime = Math.max(this.ctx.currentTime, this.nextScheduleTime)

    if (!this.isPlaying) {
      this.isPlaying = true
      this.streamingStartTime = startTime
      this.callbacks.onPlayingChange(true)
    }

    source.start(startTime)
    this.nextScheduleTime = startTime + audioBuffer.duration
    this.streamingSources.push(source)

    // Clean up finished sources
    source.onended = () => {
      const index = this.streamingSources.indexOf(source)
      if (index > -1) this.streamingSources.splice(index, 1)
    }
  }

  finishStreaming(): void {
    if (this.mode !== "streaming") return

    // Consolidate all chunks into single AudioBuffer
    const totalSamples = this.streamingChunks.reduce((sum, c) => sum + c.length, 0)
    if (totalSamples === 0) {
      this.setMode("idle")
      return
    }

    const combined = new Float32Array(totalSamples)
    let offset = 0
    for (const chunk of this.streamingChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    this.buffer = this.ctx.createBuffer(1, totalSamples, 24000)
    this.buffer.getChannelData(0).set(combined)

    // Track where we are in playback relative to streaming start
    if (this.isPlaying) {
      this.pausePosition = Math.max(0, this.ctx.currentTime - this.streamingStartTime)
      // Clamp to duration to handle edge cases
      this.pausePosition = Math.min(this.pausePosition, this.buffer.duration)
    } else {
      this.pausePosition = 0
    }

    // Clean up streaming state
    this.streamingChunks = []
    this.streamingSources = []

    this.setMode("ready")
  }

  // === Playback Controls ===
  play(): void {
    if (this.mode === "streaming") {
      // Streaming mode - audio is already playing via scheduled chunks
      return
    }

    if (this.mode !== "ready" || !this.buffer) return
    if (this.isPlaying) return

    this.activeSource = this.ctx.createBufferSource()
    this.activeSource.buffer = this.buffer
    this.activeSource.connect(this.gainNode)

    this.activeSource.onended = this.handlePlaybackEnded
    this.activeSource.start(0, this.pausePosition)
    this.playbackStartTime = this.ctx.currentTime - this.pausePosition
    this.isPlaying = true
    this.callbacks.onPlayingChange(true)
    this.startTimeUpdates()
  }

  pause(): void {
    if (this.mode !== "ready" || !this.isPlaying) return

    this.pausePosition = this.ctx.currentTime - this.playbackStartTime
    // Clamp to valid range
    if (this.buffer) {
      this.pausePosition = Math.max(0, Math.min(this.pausePosition, this.buffer.duration))
    }

    if (this.activeSource) {
      this.activeSource.onended = null // Prevent ended callback
      this.activeSource.stop()
      this.activeSource = null
    }

    this.isPlaying = false
    this.callbacks.onPlayingChange(false)
    this.stopTimeUpdates()
  }

  stop(): void {
    this.stopTimeUpdates()

    // Stop streaming sources
    for (const source of this.streamingSources) {
      try {
        source.onended = null
        source.stop()
      } catch {
        // Already stopped
      }
    }
    this.streamingSources = []
    this.streamingChunks = []

    // Stop ready mode source
    if (this.activeSource) {
      try {
        this.activeSource.onended = null
        this.activeSource.stop()
      } catch {
        // Already stopped
      }
      this.activeSource = null
    }

    this.buffer = null
    this.isPlaying = false
    this.pausePosition = 0
    this.nextScheduleTime = 0
    this.streamingStartTime = 0
    this.playbackStartTime = 0
    this.callbacks.onPlayingChange(false)
  }

  seek(seconds: number): void {
    if (this.mode !== "ready" || !this.buffer) return

    const targetTime = Math.max(0, Math.min(seconds, this.buffer.duration))

    if (this.isPlaying) {
      // Stop current playback
      if (this.activeSource) {
        this.activeSource.onended = null
        this.activeSource.stop()
      }

      // Start from new position
      this.activeSource = this.ctx.createBufferSource()
      this.activeSource.buffer = this.buffer
      this.activeSource.connect(this.gainNode)

      this.activeSource.onended = this.handlePlaybackEnded
      this.activeSource.start(0, targetTime)
      this.playbackStartTime = this.ctx.currentTime - targetTime
    } else {
      this.pausePosition = targetTime
    }

    this.callbacks.onTimeUpdate(targetTime, this.getDuration())
  }

  // === State ===
  getCurrentTime(): number {
    if (this.mode === "streaming") {
      if (!this.isPlaying) return 0
      return Math.max(0, this.ctx.currentTime - this.streamingStartTime)
    }

    if (this.mode === "ready") {
      if (this.isPlaying) {
        return Math.max(0, this.ctx.currentTime - this.playbackStartTime)
      }
      return this.pausePosition
    }

    return 0
  }

  getDuration(): number {
    if (this.mode === "streaming") {
      // Estimate duration from scheduled chunks
      const totalSamples = this.streamingChunks.reduce((sum, c) => sum + c.length, 0)
      return totalSamples / 24000
    }

    if (this.buffer) {
      return this.buffer.duration
    }

    return 0
  }

  setVolume(vol: number): void {
    this.gainNode.gain.value = vol
  }

  get canPause(): boolean {
    return this.mode === "ready"
  }

  get canSeek(): boolean {
    return this.mode === "ready"
  }

  dispose(): void {
    this.stop()
    this.gainNode.disconnect()
    this.setMode("idle")
  }

  private setMode(mode: PlayerMode): void {
    if (this.mode !== mode) {
      this.mode = mode
      this.callbacks.onModeChange(mode)
    }
  }

  private handlePlaybackEnded = () => {
    if (this.isPlaying && this.mode === "ready") {
      const currentPos = this.ctx.currentTime - this.playbackStartTime
      if (currentPos >= this.buffer!.duration - 0.1) {
        this.isPlaying = false
        this.pausePosition = 0
        this.activeSource = null
        this.callbacks.onPlayingChange(false)
        this.callbacks.onEnded()
        this.stopTimeUpdates()
      }
    }
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

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Int16Array(bytes.buffer)
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768
  }
  return float32
}
