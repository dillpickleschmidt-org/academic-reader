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

export function TTSPlaybackBar() {
  const isEnabled = useTTSSelector((s) => s.isEnabled)
  const isPlaying = useTTSSelector((s) => s.isPlaying)
  const isSynthesizing = useTTSSelector((s) => s.isSynthesizing)
  const isLoading = useTTSSelector((s) => s.isLoading)
  const currentVoice = useTTSSelector((s) => s.currentVoice)
  const audioUrl = useTTSSelector((s) => s.audioUrl)

  const { togglePlayPause, skip, setVoice } = useTTSActions()

  if (!isEnabled) return null

  const isProcessing = isLoading || isSynthesizing
  const hasAudio = !!audioUrl

  return (
    <div className="shrink-0 bg-(--reader-code-bg) border-t border-(--reader-border)">
      <div className="relative flex items-center justify-center py-2 md:pr-12">
        {/* Centered playback controls */}
        <div className="flex items-center gap-1">
          {/* Rewind 15s */}
          <button
            type="button"
            onClick={() => skip(-15)}
            disabled={!hasAudio || isProcessing}
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
            disabled={!hasAudio || isProcessing}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isProcessing ? (
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
            disabled={!hasAudio || isProcessing}
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
            disabled={isProcessing}
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
