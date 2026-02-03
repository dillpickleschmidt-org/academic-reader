import { Pause, Play, RotateCcw, RotateCw, Loader2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/core/ui/primitives/select"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { useVoiceSelection } from "@/hooks/use-voices"

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function TTSPlaybackBar() {
  const mode = useAudioSelector((s) => s.playback.mode)
  const isPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const canPause = useAudioSelector((s) => s.playback.canPause)
  const canSeek = useAudioSelector((s) => s.playback.canSeek)
  const currentVoice = useAudioSelector((s) => s.narrator.voice)
  const currentTime = useAudioSelector((s) => s.playback.currentTime)
  const durationMs = useAudioSelector((s) => s.playback.durationMs)

  const { togglePlayPause, skip, setVoice } = useAudioActions()
  const { voices } = useVoiceSelection(currentVoice, setVoice)

  // Show bar when streaming or ready (audio is available)
  if (mode === "idle" || mode === "loading") return null

  const totalDuration = durationMs / 1000
  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  return (
    <div className="shrink-0 bg-(--card) border-t border-(--reader-border)">
      {/* Progress bar */}
      <div className="relative h-1 bg-(--reader-border)">
        <div
          className="absolute inset-y-0 left-0 bg-(--reader-accent) transition-[width] duration-100"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="relative flex items-center justify-center py-2 md:pr-12">
        {/* Time display - left side */}
        <div className="absolute left-4 flex items-center gap-2 text-xs text-(--reader-text-muted)">
          <span>{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(totalDuration)}</span>
          {mode === "streaming" && <Loader2 size={12} className="ml-1 animate-spin" />}
        </div>

        {/* Centered playback controls */}
        <div className="flex items-center gap-1">
          {/* Rewind 15s - only show when seekable */}
          {canSeek && (
            <button
              type="button"
              onClick={() => skip(-15)}
              className="relative flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors"
              title="Rewind 15 seconds"
            >
              <RotateCcw size={18} />
              <span className="absolute text-[9px] font-medium">15</span>
            </button>
          )}

          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlayPause}
            disabled={!canPause}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>

          {/* Skip 15s - only show when seekable */}
          {canSeek && (
            <button
              type="button"
              onClick={() => skip(15)}
              className="relative flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors"
              title="Skip 15 seconds"
            >
              <RotateCw size={18} />
              <span className="absolute text-[9px] font-medium">15</span>
            </button>
          )}
        </div>

        {/* Speaker selector - absolute right */}
        <div className="absolute right-4">
          <Select
            value={currentVoice}
            onValueChange={(v) => v && setVoice(v)}
            disabled={mode === "streaming"}
          >
            <SelectTrigger className="h-8 w-27.5 border-none bg-transparent shadow-none text-(--reader-text) hover:bg-(--reader-border) disabled:opacity-50">
              <SelectValue>
                {voices.find((v) => v.id === currentVoice)?.displayName}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
