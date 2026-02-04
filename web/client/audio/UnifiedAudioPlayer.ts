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

  // Ready mode state
  private buffer: AudioBuffer | null = null
  private activeSource: AudioBufferSourceNode | null = null

  // Streaming mode state
  private streamingChunks: Float32Array[] = []
  private streamingSources: AudioBufferSourceNode[] = []
  private nextScheduleTime = 0

  // Shared playback state
  private startTime = 0 // ctx.currentTime when playback began (used to derive current position)
  private pausePosition = 0

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

    // Parse WAV manually to create a 24000Hz buffer (matching streaming path).
    // decodeAudioData resamples to AudioContext's native rate, which can
    // introduce timing differences vs the streaming playback path.
    this.buffer = parseWavToBuffer(this.ctx, arrayBuffer)

    this.pausePosition = 0
    this.setMode("ready")
  }

  // === Streaming Audio ===
  startStreaming(): void {
    this.stop()
    this.streamingChunks = []
    this.streamingSources = []
    this.nextScheduleTime = 0
    this.startTime = 0
    this.pausePosition = 0
    this.isPlaying = true
    this.setMode("streaming")
    this.callbacks.onPlayingChange(true)
    this.startTimeUpdates()
  }

  addPcmChunk(pcmBase64: string): void {
    if (this.mode !== "streaming") return

    const pcmData = base64ToInt16Array(pcmBase64)
    const floatData = int16ToFloat32(pcmData)

    this.streamingChunks.push(floatData)

    // Don't schedule audio while paused — chunks accumulate for later
    if (!this.isPlaying) return

    // Create and schedule audio buffer
    const audioBuffer = this.ctx.createBuffer(1, floatData.length, 24000)
    audioBuffer.getChannelData(0).set(floatData)

    const source = this.ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.gainNode)

    // Schedule seamlessly after previous chunk
    const startTime = Math.max(this.ctx.currentTime, this.nextScheduleTime)

    if (this.startTime === 0) {
      this.startTime = startTime
    }

    source.start(startTime)
    this.nextScheduleTime = startTime + audioBuffer.duration
    this.streamingSources.push(source)

    source.onended = () => {
      const index = this.streamingSources.indexOf(source)
      if (index > -1) this.streamingSources.splice(index, 1)
    }
  }

  finishStreaming(): void {
    if (this.mode !== "streaming") return

    const wasPlaying = this.isPlaying

    this.stopStreamingSources()

    const consolidated = this.consolidateChunks()
    if (!consolidated) {
      this.setMode("idle")
      return
    }

    this.buffer = consolidated

    if (wasPlaying) {
      this.pausePosition = Math.max(0, this.ctx.currentTime - this.startTime)
      this.pausePosition = Math.min(this.pausePosition, this.buffer.duration)
    }

    this.streamingChunks = []
    this.setMode("ready")

    if (wasPlaying) {
      this.activeSource = this.ctx.createBufferSource()
      this.activeSource.buffer = this.buffer
      this.activeSource.connect(this.gainNode)
      this.activeSource.onended = this.handlePlaybackEnded
      this.activeSource.start(0, this.pausePosition)
      this.startTime = this.ctx.currentTime - this.pausePosition
    }
  }

  // === Playback Controls ===
  play(): void {
    if (this.isPlaying) return

    if (this.mode === "streaming") {
      if (!this.resumeStreamingFrom(this.pausePosition)) return
      this.isPlaying = true
      this.callbacks.onPlayingChange(true)
      return
    }

    if (this.mode !== "ready" || !this.buffer) return

    this.activeSource = this.ctx.createBufferSource()
    this.activeSource.buffer = this.buffer
    this.activeSource.connect(this.gainNode)

    this.activeSource.onended = this.handlePlaybackEnded
    this.activeSource.start(0, this.pausePosition)
    this.startTime = this.ctx.currentTime - this.pausePosition
    this.isPlaying = true
    this.callbacks.onPlayingChange(true)
    this.startTimeUpdates()
  }

  pause(): void {
    if (!this.isPlaying) return

    if (this.mode === "streaming") {
      this.pausePosition = Math.max(0, this.ctx.currentTime - this.startTime)
      this.stopStreamingSources()
      this.isPlaying = false
      this.callbacks.onPlayingChange(false)
      // Keep time updates running so duration display grows as chunks arrive
      return
    }

    if (this.mode !== "ready") return

    this.pausePosition = this.ctx.currentTime - this.startTime
    if (this.buffer) {
      this.pausePosition = Math.max(0, Math.min(this.pausePosition, this.buffer.duration))
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
    this.stopStreamingSources()
    this.streamingChunks = []

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
    this.startTime = 0
    this.callbacks.onPlayingChange(false)
  }

  seek(seconds: number): void {
    if (this.mode === "streaming") {
      const bufferedDuration = this.getDuration()
      const targetTime = Math.max(0, Math.min(seconds, bufferedDuration))

      if (this.isPlaying) {
        this.stopStreamingSources()
        this.resumeStreamingFrom(targetTime)
      } else {
        this.pausePosition = targetTime
      }

      this.callbacks.onTimeUpdate(targetTime, bufferedDuration)
      return
    }

    if (this.mode !== "ready" || !this.buffer) return

    const targetTime = Math.max(0, Math.min(seconds, this.buffer.duration))

    if (this.isPlaying) {
      if (this.activeSource) {
        this.activeSource.onended = null
        this.activeSource.stop()
      }

      this.activeSource = this.ctx.createBufferSource()
      this.activeSource.buffer = this.buffer
      this.activeSource.connect(this.gainNode)

      this.activeSource.onended = this.handlePlaybackEnded
      this.activeSource.start(0, targetTime)
      this.startTime = this.ctx.currentTime - targetTime
    } else {
      this.pausePosition = targetTime
    }

    this.callbacks.onTimeUpdate(targetTime, this.getDuration())
  }

  // === State ===
  getCurrentTime(): number {
    if (this.mode === "idle") return 0
    if (!this.isPlaying || this.startTime === 0) return this.pausePosition
    return Math.max(0, this.ctx.currentTime - this.startTime)
  }

  getDuration(): number {
    if (this.mode === "streaming") {
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
    return this.mode === "streaming" || this.mode === "ready"
  }

  get canSeek(): boolean {
    return this.mode === "streaming" || this.mode === "ready"
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
      const currentPos = this.ctx.currentTime - this.startTime
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

  private resumeStreamingFrom(position: number): boolean {
    const consolidated = this.consolidateChunks()
    if (!consolidated) return false

    const source = this.ctx.createBufferSource()
    source.buffer = consolidated
    source.connect(this.gainNode)

    source.start(0, position)
    this.startTime = this.ctx.currentTime - position
    this.nextScheduleTime = this.ctx.currentTime + (consolidated.duration - position)

    this.streamingSources.push(source)
    source.onended = () => {
      const index = this.streamingSources.indexOf(source)
      if (index > -1) this.streamingSources.splice(index, 1)
    }
    return true
  }

  private consolidateChunks(): AudioBuffer | null {
    const totalSamples = this.streamingChunks.reduce((sum, c) => sum + c.length, 0)
    if (totalSamples === 0) return null

    const combined = new Float32Array(totalSamples)
    let offset = 0
    for (const chunk of this.streamingChunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const buffer = this.ctx.createBuffer(1, totalSamples, 24000)
    buffer.getChannelData(0).set(combined)
    return buffer
  }

  private stopStreamingSources(): void {
    for (const source of this.streamingSources) {
      try {
        source.onended = null
        source.stop()
      } catch {
        // Already stopped
      }
    }
    this.streamingSources = []
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

function parseWavToBuffer(ctx: AudioContext, arrayBuffer: ArrayBuffer): AudioBuffer {
  const view = new DataView(arrayBuffer)
  const sampleRate = view.getUint32(24, true)
  const pcmData = new Int16Array(arrayBuffer, 44)
  const floatData = int16ToFloat32(pcmData)
  const buffer = ctx.createBuffer(1, floatData.length, sampleRate)
  buffer.getChannelData(0).set(floatData)
  return buffer
}
