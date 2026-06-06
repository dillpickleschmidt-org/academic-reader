import { Volume2, VolumeX } from "lucide-react"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { Label } from "@academic-reader/ui/primitives/label"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { VoiceMenu } from "@/components/VoiceMenu"
import { useRuntimeConfig } from "@/context/RuntimeConfigContext"

export function NarratorTab() {
  const { ttsEnabled } = useRuntimeConfig()
  const speed = useAudioSelector((s) => s.narrator.speed)
  const volume = useAudioSelector((s) => s.narrator.volume)

  const { setNarratorSpeed, setNarratorVolume } = useAudioActions()

  const handleSpeedChange = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : value
    setNarratorSpeed(v)
  }

  const handleVolumeChange = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : value
    setNarratorVolume(v)
  }

  if (!ttsEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Narration is disabled for this deployment.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Voice</Label>
        <VoiceMenu triggerClassName="w-full" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">Speed</Label>
          <span className="text-xs text-foreground/70 tabular-nums">
            {speed.toFixed(1)}x
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">0.5x</span>
          <Slider
            value={[speed]}
            onValueChange={handleSpeedChange}
            min={0.5}
            max={2}
            step={0.1}
            size="sm"
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground">2x</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">Volume</Label>
          <span className="text-xs text-foreground/70 tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <VolumeX className="size-4 text-muted-foreground" />
          <Slider
            value={[volume]}
            onValueChange={handleVolumeChange}
            min={0}
            max={1}
            step={0.01}
            size="sm"
            className="flex-1"
          />
          <Volume2 className="size-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}
