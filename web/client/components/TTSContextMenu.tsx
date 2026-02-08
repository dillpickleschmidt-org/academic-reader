import { Play, FileAudio } from "lucide-react"
import { Popover, PopoverContent } from "@repo/core/ui/primitives/popover"
import { useAudioActions, useAudioSelector } from "@/context/AudioContext"
import { useCurrentVoiceCapabilities } from "@/hooks/use-voices"

interface TTSContextMenuProps {
  anchorElement: HTMLElement | null
  blockId: string | null
  wordIndex: number | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function TTSContextMenu({
  anchorElement,
  blockId,
  wordIndex,
  isOpen,
  onOpenChange,
}: TTSContextMenuProps) {
  const { loadBlockTTS, processDocument } = useAudioActions()
  const voiceId = useAudioSelector((s) => s.narrator.voice)
  const batchStarted = useAudioSelector((s) => s.batchStarted)
  const capabilities = useCurrentVoiceCapabilities(voiceId)

  const handlePlay = () => {
    if (!blockId) return

    loadBlockTTS(
      blockId,
      wordIndex !== null ? { wordIndex } : undefined,
    )
    onOpenChange(false)
  }

  const handleProcessDocument = () => {
    if (!blockId) return
    processDocument(blockId, wordIndex ?? undefined)
    onOpenChange(false)
  }

  const showPlay = capabilities?.perBlock || batchStarted
  const showProcessDocument = capabilities?.fullDocument && !batchStarted

  if (!anchorElement || (!showPlay && !showProcessDocument)) return null

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchorElement}
        side="top"
        sideOffset={8}
        className="w-auto p-1 flex items-center gap-1"
      >
        {showPlay && (
          <button
            type="button"
            onClick={handlePlay}
            className="flex items-center justify-center size-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Play from here"
          >
            <Play className="size-4" />
          </button>
        )}
        {showProcessDocument && (
          <button
            type="button"
            onClick={handleProcessDocument}
            className="flex items-center justify-center size-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Process document"
          >
            <FileAudio className="size-4" />
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
