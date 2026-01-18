import { Pause, Play, RotateCcw, RotateCw, Loader2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/core/ui/primitives/select"
import { useTTSSelector, useTTSActions } from "@/context/TTSContext"

const SPEAKERS = [
  { value: "male_1", label: "Male 1" },
  { value: "female_1", label: "Female 1" },
] as const

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function TTSPlaybackBar() {
  const isEnabled = useTTSSelector((s) => s.isEnabled)
  const isPlaying = useTTSSelector((s) => s.isPlaying)
  const isSynthesizing = useTTSSelector((s) => s.isSynthesizing)
  const isLoading = useTTSSelector((s) => s.isLoading)
  const currentVoice = useTTSSelector((s) => s.currentVoice)
  const segments = useTTSSelector((s) => s.segments)
  const currentSegmentIndex = useTTSSelector((s) => s.currentSegmentIndex)
  const currentTime = useTTSSelector((s) => s.currentTime)
  const totalDuration = useTTSSelector((s) => s.totalDuration)

  const { togglePlayPause, skip, setVoice } = useTTSActions()

  if (!isEnabled) return null

  const hasSegments = segments.length > 0
  const currentSegment = segments[currentSegmentIndex]
  const hasAudio = currentSegment?.status === "ready"

  // Calculate progress percentage
  const progressPercent =
    totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  return (
    <div className="shrink-0 bg-(--reader-code-bg) border-t border-(--reader-border)">
      {/* Progress bar */}
      {hasSegments && (
        <div className="relative h-1 bg-(--reader-border)">
          <div
            className="absolute inset-y-0 left-0 bg-(--reader-accent) transition-[width] duration-100"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Segment markers */}
          {segments.length > 1 && (
            <div className="absolute inset-0 flex">
              {segments.map((_, i) => {
                if (i === 0) return null
                // Calculate position of this segment boundary
                let position = 0
                for (let j = 0; j < i; j++) {
                  position += segments[j].durationMs || 0
                }
                const percent =
                  totalDuration > 0
                    ? (position / 1000 / totalDuration) * 100
                    : 0
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-px bg-(--reader-text-muted)/30"
                    style={{ left: `${percent}%` }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="relative flex items-center justify-center py-2 md:pr-12">
        {/* Time display - left side */}
        {hasSegments && (
          <div className="absolute left-4 flex items-center gap-2 text-xs text-(--reader-text-muted)">
            <span>{formatTime(currentTime)}</span>
            <span>/</span>
            <span>{formatTime(totalDuration)}</span>
            {segments.length > 1 && (
              <>
                <span className="mx-1">•</span>
                <span>
                  {currentSegmentIndex + 1}/{segments.length}
                </span>
              </>
            )}
            {isSynthesizing && (
              <Loader2 size={12} className="ml-1 animate-spin" />
            )}
          </div>
        )}

        {/* Centered playback controls */}
        <div className="flex items-center gap-1">
          {/* Rewind 15s */}
          <button
            type="button"
            onClick={() => skip(-15)}
            disabled={!hasAudio || isLoading}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Rewind 15 seconds"
          >
            <RotateCcw size={18} />
            <span className="absolute text-[9px] font-medium">15</span>
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlayPause}
            disabled={!hasAudio || isLoading}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={18} />
            ) : (
              <Play size={18} />
            )}
          </button>

          {/* Skip 15s */}
          <button
            type="button"
            onClick={() => skip(15)}
            disabled={!hasAudio || isLoading}
            className="relative flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Skip 15 seconds"
          >
            <RotateCw size={18} />
            <span className="absolute text-[9px] font-medium">15</span>
          </button>
        </div>

        {/* Speaker selector - absolute right */}
        <div className="absolute right-4">
          <Select
            value={currentVoice}
            onValueChange={(v) => v && setVoice(v)}
            disabled={isLoading}
          >
            <SelectTrigger className="h-8 w-27.5 border-none bg-transparent shadow-none text-(--reader-text) hover:bg-(--reader-border) disabled:opacity-50">
              <SelectValue>
                {SPEAKERS.find((s) => s.value === currentVoice)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SPEAKERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
