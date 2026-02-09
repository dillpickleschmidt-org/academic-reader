import { Volume2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@academic-reader/ui/primitives/select"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { DEFAULT_PRESETS } from "@/audio/constants"

export function AudioSettingsFooter() {
  const masterVolume = useAudioSelector((s) => s.master.volume)
  const activePreset = useAudioSelector((s) => s.master.activePreset)
  const { setMasterVolume, setActivePreset } = useAudioActions()

  const handleVolumeChange = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : value
    setMasterVolume(v)
  }

  const presets = DEFAULT_PRESETS

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
      <Select
        value={activePreset ?? ""}
        onValueChange={setActivePreset}
        disabled={presets.length === 0}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue>
            {activePreset
              ? presets.find((p) => p.id === activePreset)?.name
              : "Preset"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
