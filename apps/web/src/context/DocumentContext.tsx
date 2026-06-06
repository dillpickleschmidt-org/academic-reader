import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id } from "@academic-reader/convex/convex/_generated/dataModel"
import type {
  ChunkBlock,
  TocResult,
} from "@academic-reader/api-client/schemas/document"
import { useDocumentEnrichments } from "@/hooks/use-document-enrichments"
import { useRuntimeConfig } from "@/context/RuntimeConfigContext"

export interface AudioReadinessVoice {
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
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | null | undefined
  summary: string | undefined
  audioReadiness: AudioReadiness | undefined
  initialAudioVoiceId: string | null
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | null | undefined
  initialAudioVoiceId?: string | null
  children: ReactNode
}

export function DocumentProvider({
  documentId,
  chunks,
  documentName,
  toc: initialToc,
  initialAudioVoiceId = null,
  children,
}: DocumentProviderProps) {
  const { ttsEnabled } = useRuntimeConfig()
  const { toc: enrichedToc, summary } = useDocumentEnrichments(documentId)

  const typedId = documentId as Id<"documents"> | null
  const audioReadiness = useQuery(
    api.api.ttsAudio.getDocumentAudioReadiness,
    typedId && ttsEnabled ? { documentId: typedId } : "skip",
  ) as AudioReadiness | undefined

  const toc = enrichedToc === undefined ? initialToc : enrichedToc

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
