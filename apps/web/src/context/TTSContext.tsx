import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import { toast } from "sonner"

interface TTSContextValue {
  isEnabled: boolean
  isLoading: boolean
  currentBlockId: string | null
  rewordedText: string | null
  error: string | null
  enable: () => void
  disable: () => void
  loadChunkTTS: (blockId: string, chunkContent: string) => Promise<void>
}

const TTSContext = createContext<TTSContextValue | null>(null)

interface TTSProviderProps {
  documentId: string | null
  children: ReactNode
}

export function TTSProvider({ documentId, children }: TTSProviderProps) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [rewordedText, setRewordedText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enable = useCallback(() => {
    setIsEnabled(true)
    setError(null)
  }, [])

  const disable = useCallback(() => {
    setIsEnabled(false)
    setRewordedText(null)
    setCurrentBlockId(null)
    setError(null)
  }, [])

  const loadChunkTTS = useCallback(
    async (blockId: string, chunkContent: string) => {
      if (!documentId) {
        console.error("[TTS] No documentId - document not saved")
        setError("Document not saved - TTS requires a saved document")
        toast.error("Document not saved - TTS requires a saved document")
        return
      }

      setIsLoading(true)
      setError(null)
      setCurrentBlockId(blockId)

      const toastId = toast.loading("Rewriting text for speech...")

      try {
        const response = await fetch("/api/tts/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ documentId, blockId, chunkContent }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || "Failed to reword text")
        }

        const data = await response.json()
        setRewordedText(data.rewordedText)
        toast.success(data.cached ? "Loaded from cache" : "Text rewritten for speech", { id: toastId })
      } catch (err) {
        console.error("[TTS] Error:", err)
        const errorMsg = err instanceof Error ? err.message : "TTS processing failed"
        setError(errorMsg)
        setRewordedText(null)
        toast.error(errorMsg, { id: toastId })
      } finally {
        setIsLoading(false)
      }
    },
    [documentId],
  )

  return (
    <TTSContext.Provider
      value={{
        isEnabled,
        isLoading,
        currentBlockId,
        rewordedText,
        error,
        enable,
        disable,
        loadChunkTTS,
      }}
    >
      {children}
    </TTSContext.Provider>
  )
}

export function useTTS() {
  const context = useContext(TTSContext)
  if (!context) {
    throw new Error("useTTS must be used within a TTSProvider")
  }
  return context
}
