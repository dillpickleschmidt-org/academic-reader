import { Checkbox } from "@academic-reader/ui/primitives/checkbox"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { Label } from "@academic-reader/ui/primitives/label"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@academic-reader/ui/primitives/context-menu"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import type { AmbientSoundId } from "@/audio/types"

const DEFAULT_VOLUME = 0.5

export function AmbienceTab() {
  const sounds = useAudioSelector((s) => s.ambience.sounds)
  const { toggleAmbientSound, setAmbientVolume } = useAudioActions()

  const handleVolumeChange = (
    soundId: AmbientSoundId,
    value: number | readonly number[],
  ) => {
    const v = Array.isArray(value) ? value[0] : value
    setAmbientVolume(soundId, v)
  }

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-xs text-muted-foreground">Ambient Sounds</Label>

      <div className="flex flex-col gap-1">
        {sounds.map((sound) => {
          const isAvailable = !!sound.src
          return (
            <div
              key={sound.id}
              className="flex items-center gap-3 rounded-md py-1"
            >
              <Checkbox
                id={`ambience-${sound.id}`}
                checked={sound.enabled}
                disabled={!isAvailable}
                onCheckedChange={(checked) =>
                  toggleAmbientSound(sound.id, checked === true)
                }
              />
              <ContextMenu>
                <ContextMenuTrigger className="flex flex-1 items-center gap-3">
                  <label
                    htmlFor={`ambience-${sound.id}`}
                    className={`min-w-25 text-sm ${isAvailable ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground"}`}
                  >
                    {sound.name}
                  </label>
                  <Slider
                    value={[sound.volume]}
                    onValueChange={(value) =>
                      handleVolumeChange(sound.id, value)
                    }
                    min={0}
                    max={1}
                    step={0.01}
                    size="sm"
                    className={`flex-1 transition-opacity ${!sound.enabled || !isAvailable ? "pointer-events-none opacity-30" : ""}`}
                    disabled={!sound.enabled || !isAvailable}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() => setAmbientVolume(sound.id, DEFAULT_VOLUME)}
                  >
                    Reset volume
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          )
        })}
      </div>
    </div>
  )
}
