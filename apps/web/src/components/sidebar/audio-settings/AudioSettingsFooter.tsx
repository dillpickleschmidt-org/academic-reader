import { Volume2 } from "lucide-react"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"

export function AudioSettingsFooter() {
  const masterVolume = useAudioSelector((s) => s.master.volume)
  const { setMasterVolume } = useAudioActions()

  const handleVolumeChange = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : value
    setMasterVolume(v)
  }

  return (
    <div className="flex items-center gap-3 border-t pt-3">
      <Volume2 className="size-4 shrink-0 text-muted-foreground" />
      <Slider
        value={[masterVolume]}
        onValueChange={handleVolumeChange}
        min={0}
        max={1}
        step={0.01}
        size="sm"
        className="flex-1"
      />
    </div>
  )
}
