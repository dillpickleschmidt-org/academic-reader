import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { ChunkBlock, TocResult } from "@repo/core/types/api"
import { useDocumentEnrichments } from "@/hooks/use-document-enrichments"

interface DocumentContextValue {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | undefined
  ttsMap: Map<string, boolean> | undefined
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | undefined
  children: ReactNode
}

export function DocumentProvider({
  documentId,
  chunks,
  documentName,
  toc: initialToc,
  children,
}: DocumentProviderProps) {
  const { toc: enrichedToc, ttsMap } = useDocumentEnrichments(documentId)

  // Prefer enriched TOC from Convex subscription over initial SSE value
  const toc = enrichedToc ?? initialToc

  const value = useMemo(
    () => ({ documentId, chunks, documentName, toc, ttsMap }),
    [documentId, chunks, documentName, toc, ttsMap],
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
