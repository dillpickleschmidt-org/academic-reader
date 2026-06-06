import { Pause, Play, RotateCcw, RotateCw, Loader2 } from "lucide-react"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { VoiceMenu } from "@/components/VoiceMenu"

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function PlaybackProgress({ isWaiting }: { isWaiting: boolean }) {
  const currentTime = useAudioSelector((s) => s.playback.currentTime)
  const durationMs = useAudioSelector((s) => s.playback.durationMs)

  const totalDuration = durationMs / 1000
  const progressPercent =
    totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  return (
    <>
      <div className="relative h-1 bg-(--reader-border)">
        <div
          className="absolute inset-y-0 left-0 bg-(--reader-accent) transition-[width] duration-100"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="absolute left-4 flex items-center gap-2 text-xs text-(--reader-text-muted)">
        <span>{formatTime(currentTime)}</span>
        <span>/</span>
        <span>{formatTime(totalDuration)}</span>
        {isWaiting && (
          <>
            <Loader2 size={12} className="ml-1 animate-spin" />
            <span>Waiting for audio…</span>
          </>
        )}
      </div>
    </>
  )
}

export function TTSPlaybackBar() {
  const mode = useAudioSelector((s) => s.playback.mode)
  const isPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const canControl = mode === "ready"

  const { togglePlayPause, skip } = useAudioActions()

  if (mode === "idle") return null

  return (
    <div className="shrink-0 bg-(--card) border-t border-(--reader-border)">
      {mode === "loading" ? (
        <div className="h-1 bg-(--reader-border)" />
      ) : (
        <PlaybackProgress isWaiting={mode === "waiting"} />
      )}

      <div className="relative flex items-center justify-center py-2 md:pr-12">
        <div className="flex items-center gap-1">
          {canControl && (
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

          {mode === "loading" || mode === "waiting" ? (
            <div className="flex items-center justify-center w-9 h-9">
              <Loader2
                size={18}
                className="animate-spin text-(--reader-text-muted)"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={togglePlayPause}
              disabled={!canControl}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-(--reader-text-muted) hover:text-(--reader-text) hover:bg-(--reader-border) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
          )}

          {canControl && (
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

        <div className="absolute right-4">
          <VoiceMenu
            compact
            triggerClassName="h-8 w-27.5 border-none bg-transparent shadow-none text-(--reader-text) hover:bg-(--reader-border)"
          />
        </div>
      </div>
    </div>
  )
}
