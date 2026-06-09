import { useRef, useState } from "react"
import {
  ChevronUp,
  ChevronDown,
  X,
  Volume2,
  VolumeX,
  Plus,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
} from "lucide-react"
import { Button } from "@academic-reader/ui/primitives/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@academic-reader/ui/primitives/popover"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@academic-reader/ui/primitives/context-menu"
import { Switch } from "@academic-reader/ui/primitives/switch"
import { Slider } from "@academic-reader/ui/primitives/slider"
import { Checkbox } from "@academic-reader/ui/primitives/checkbox"
import { Label } from "@academic-reader/ui/primitives/label"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { MUSIC_TRACKS } from "@/audio/constants"

const DEFAULT_VOLUME = 0.5

export function MusicTab() {
  const playlist = useAudioSelector((s) => s.music.playlist)
  const currentTrackIndex = useAudioSelector((s) => s.music.currentTrackIndex)
  const isPlaying = useAudioSelector((s) => s.music.isPlaying)
  const volume = useAudioSelector((s) => s.music.volume)
  const shuffle = useAudioSelector((s) => s.music.shuffle)
  const loop = useAudioSelector((s) => s.music.loop)

  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const musicWasPlayingRef = useRef(false)

  const {
    addTrack,
    removeTrack,
    reorderTracks,
    setMusicVolume,
    setMusicShuffle,
    setMusicLoop,
    playMusic,
    pauseMusic,
    toggleMusicPlayPause,
    nextTrack,
    previousTrack,
  } = useAudioActions()

  const handleAddTrack = (trackId: string | null) => {
    if (!trackId) return
    const track = MUSIC_TRACKS.find((t) => t.id === trackId)
    if (!track) return
    addTrack({ id: track.id, name: track.name, src: track.src })
  }

  const handleMoveTrack = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= playlist.length) return
    reorderTracks(index, newIndex)
  }

  const handleVolumeChange = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : value
    setMusicVolume(v)
  }

  const togglePreview = (trackId: string, src: string) => {
    const audio = previewAudioRef.current
    if (!audio) return

    if (previewingId === trackId) {
      audio.pause()
      setPreviewingId(null)
      if (musicWasPlayingRef.current) {
        playMusic()
        musicWasPlayingRef.current = false
      }
    } else {
      if (isPlaying) {
        musicWasPlayingRef.current = true
        pauseMusic()
      }
      const filename = src.split("/").pop()
      audio.src = `/audio/music/previews/${filename}`
      audio.play().catch(() => {})
      setPreviewingId(trackId)
    }
  }

  const stopPreview = () => {
    previewAudioRef.current?.pause()
    setPreviewingId(null)
    if (musicWasPlayingRef.current) {
      playMusic()
      musicWasPlayingRef.current = false
    }
  }

  const availableTracks = MUSIC_TRACKS.filter(
    (track) => !playlist.some((p) => p.id === track.id),
  )

  const currentTrack = playlist[currentTrackIndex]

  return (
    <div className="flex flex-col gap-4">
      {/* Playback controls */}
      {playlist.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8"
              onClick={previousTrack}
            >
              <SkipBack className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={toggleMusicPlayPause}
            >
              {isPlaying ? (
                <Pause className="size-5" />
              ) : (
                <Play className="size-5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8"
              onClick={nextTrack}
            >
              <SkipForward className="size-4" />
            </Button>
          </div>
          {currentTrack && (
            <p className="text-xs text-muted-foreground text-center truncate">
              {isPlaying ? "Now playing: " : ""}
              {currentTrack.name}
            </p>
          )}
        </div>
      )}

      {/* Playlist */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Playlist</Label>

        {playlist.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No tracks added yet
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {playlist.map((track, index) => (
              <div
                key={track.id}
                className={`flex items-center gap-1 rounded-sm px-2 py-1.5 ${
                  index === currentTrackIndex && isPlaying
                    ? "bg-accent"
                    : "bg-muted/50"
                }`}
              >
                <span className="flex-1 truncate text-sm">{track.name}</span>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => handleMoveTrack(index, "up")}
                    disabled={index === 0}
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => handleMoveTrack(index, "down")}
                    disabled={index === playlist.length - 1}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-destructive hover:text-destructive"
                    onClick={() => removeTrack(track.id)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add track */}
        {availableTracks.length > 0 && (
          <Popover
            open={popoverOpen}
            onOpenChange={(open) => {
              setPopoverOpen(open)
              if (!open) stopPreview()
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 rounded-sm"
                />
              }
            >
              <Plus className="size-4" />
              <span>Add track</span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-82 p-1 gap-1.5">
              {availableTracks.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer"
                  onClick={() => {
                    handleAddTrack(track.id)
                    setPopoverOpen(false)
                    stopPreview()
                  }}
                >
                  <span className="flex-1 text-sm truncate">{track.name}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-6 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePreview(track.id, track.src)
                      }}
                    >
                      {previewingId === track.id ? (
                        <Square className="size-3" />
                      ) : (
                        <Play className="size-3" />
                      )}
                    </Button>
                    <div className="size-6 flex items-center justify-center rounded-[min(var(--radius-md),10px)] hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 text-muted-foreground">
                      <Plus className="size-3.5" />
                    </div>
                  </div>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <audio ref={previewAudioRef} onEnded={stopPreview} />
      </div>

      {/* Volume */}
      <ContextMenu>
        <ContextMenuTrigger className="flex flex-col gap-2">
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setMusicVolume(DEFAULT_VOLUME)}>
            Reset volume
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Playback options */}
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={shuffle}
            onCheckedChange={(checked) => setMusicShuffle(checked === true)}
          />
          <span className="text-sm">Shuffle</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm text-muted-foreground">Loop</span>
          <Switch checked={loop} onCheckedChange={setMusicLoop} />
        </label>
      </div>
    </div>
  )
}
