import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@academic-reader/ui/primitives/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@academic-reader/ui/primitives/popover"
import { cn } from "@academic-reader/ui/utils"
import { VOICES } from "@academic-reader/api-client/schemas/tts"
import { useDocumentContext } from "@/context/DocumentContext"
import { useAudioActions, useAudioSelector } from "@/context/AudioContext"

const RECENT_AUDIO_ACTIVITY_MS = 2 * 60 * 1000
const NEW_DOCUMENT_AUTO_WINDOW_MS = 5 * 60 * 1000

type VoiceState =
  | { status: "loading"; selectable: false }
  | { status: "empty"; selectable: false }
  | { status: "ready"; selectable: true }
  | { status: "partial"; selectable: true }
  | { status: "generating"; selectable: true }
  | { status: "needs-generation"; selectable: false }

interface VoiceMenuProps {
  triggerClassName?: string
  compact?: boolean
}

export function VoiceMenu({ triggerClassName, compact }: VoiceMenuProps) {
  const documentContext = useDocumentContext()
  const currentVoice = useAudioSelector((s) => s.narrator.voice)
  const { setVoice, generateDocumentAudio } = useAudioActions()
  const readiness = documentContext?.audioReadiness
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const getState = (voiceId: string): VoiceState => {
    if (!readiness || !readiness.ttsReady) {
      return { status: "loading", selectable: false }
    }
    if (readiness.totalEligibleBlocks === 0) {
      return { status: "empty", selectable: false }
    }

    const voiceReady = readiness.voices[voiceId]
    const count = voiceReady.audioBlockIds.length
    const complete = count >= readiness.totalEligibleBlocks
    if (complete) return { status: "ready", selectable: true }

    const recentlyActive =
      voiceReady.latestAudioCreatedAt !== null &&
      now - voiceReady.latestAudioCreatedAt < RECENT_AUDIO_ACTIVITY_MS
    const initialAutoLikely =
      documentContext?.initialAudioVoiceId === voiceId &&
      count === 0 &&
      now - readiness.documentCreatedAt < NEW_DOCUMENT_AUTO_WINDOW_MS

    if (recentlyActive || initialAutoLikely) {
      return { status: "generating", selectable: true }
    }

    if (count > 0) return { status: "partial", selectable: true }

    return { status: "needs-generation", selectable: false }
  }

  const handleGenerate = async (voiceId: string) => {
    const started = await generateDocumentAudio(voiceId)
    if (started) setVoice(voiceId)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "sm" : "default"}
            className={cn("justify-between", triggerClassName)}
          >
            {VOICES.find((voice) => voice.id === currentVoice)?.displayName ??
              currentVoice}
          </Button>
        }
      />
      <PopoverContent className="w-56 p-1" align="end">
        {VOICES.map((voice) => {
          const state = getState(voice.id)
          const selected = voice.id === currentVoice
          return (
            <div
              key={voice.id}
              className={cn(
                "relative flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                selected && "bg-accent text-accent-foreground",
                state.selectable
                  ? "cursor-pointer hover:bg-accent hover:text-accent-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                if (state.selectable) setVoice(voice.id)
              }}
            >
              <span>{voice.displayName}</span>
              {state.status === "loading" || state.status === "generating" ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  {state.status === "loading" ? "Preparing…" : "Generating…"}
                </span>
              ) : state.status === "empty" ? (
                <span className="text-xs text-muted-foreground">No audio</span>
              ) : state.status === "needs-generation" ||
                state.status === "partial" ? (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:opacity-90"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!readiness?.ttsReady) {
                      toast.info("Narration text is still being prepared")
                      return
                    }
                    void handleGenerate(voice.id)
                  }}
                >
                  Generate
                </button>
              ) : null}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
