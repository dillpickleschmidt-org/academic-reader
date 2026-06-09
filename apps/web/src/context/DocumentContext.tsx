import { createContext, useContext, useMemo, type ReactNode } from "react"
import type {
  ChunkBlock,
  TocResult,
} from "@academic-reader/api-client/schemas/document"

interface AudioReadinessVoice {
  audioBlockIds: string[]
  latestAudioCreatedAt: number | null
}

export interface AudioReadiness {
  documentCreatedAt: number
  ttsReady: boolean
  eligibleBlockIds: string[]
  totalEligibleBlocks: number
  voices: Record<string, AudioReadinessVoice>
}

interface DocumentContextValue {
  documentId: string
  chunks: ChunkBlock[]
  documentName: string
  toc: TocResult | null
  summary: string | null
  audioReadiness: AudioReadiness | undefined
  initialAudioVoiceId: string | null
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps extends DocumentContextValue {
  children: ReactNode
}

export function DocumentProvider({
  documentId,
  chunks,
  documentName,
  toc,
  summary,
  audioReadiness,
  initialAudioVoiceId,
  children,
}: DocumentProviderProps) {
  const value = useMemo(
    () => ({
      documentId,
      chunks,
      documentName,
      toc,
      summary,
      audioReadiness,
      initialAudioVoiceId,
    }),
    [
      documentId,
      chunks,
      documentName,
      toc,
      summary,
      audioReadiness,
      initialAudioVoiceId,
    ],
  )

  return (
    <DocumentContext.Provider value={value}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocumentContext() {
  return useContext(DocumentContext)
}
