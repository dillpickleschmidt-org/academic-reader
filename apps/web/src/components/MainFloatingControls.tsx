import { Palette, Volume2 } from "lucide-react"
import { Button } from "@academic-reader/ui/primitives/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@academic-reader/ui/primitives/dropdown-menu"
import { AudioSettingsPopover } from "@/components/sidebar/audio-settings/AudioSettingsPopover"
import { ColorThemeMenuContent } from "@/components/sidebar/ColorThemeSelector"
import { useAudioSelector } from "@/context/AudioContext"
import { useReaderTheme } from "@/hooks/use-reader-theme"

export function MainFloatingControls() {
  const [readerMode, setReaderMode] = useReaderTheme()
  const isMusicPlaying = useAudioSelector((s) => s.music.isPlaying)
  const hasActiveAmbience = useAudioSelector((s) =>
    s.ambience.sounds.some((sound) => sound.enabled),
  )
  const isAudioActive = isMusicPlaying || hasActiveAmbience

  return (
    <div className="fixed left-4 bottom-4 z-50 flex flex-col gap-[2px] rounded-[8px] bg-card p-1">
      <AudioSettingsPopover
        showNarrator={false}
        side="right"
        align="end"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-[6px] border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-border hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground"
            data-active={isAudioActive}
            title="Audio"
          >
            <Volume2 className="size-[18px]" />
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-[6px] border-0 bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary! hover:brightness-110 aria-expanded:bg-primary! aria-expanded:text-primary-foreground aria-expanded:brightness-110"
              title="Theme"
            >
              <Palette className="size-[18px]" />
            </Button>
          }
        />
        <DropdownMenuContent
          className="min-w-56 rounded-lg"
          side="right"
          align="end"
          sideOffset={8}
        >
          <ColorThemeMenuContent
            readerMode={readerMode}
            onReaderModeChange={setReaderMode}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
