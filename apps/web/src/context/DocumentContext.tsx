import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { ChunkBlock, TocResult } from "@academic-reader/api-client/schemas/document"
import { useDocumentEnrichments } from "@/hooks/use-document-enrichments"

interface DocumentContextValue {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | undefined
  ttsMap: Map<string, boolean> | undefined
  ttsTextMap: Map<string, string> | undefined
  summary: string | undefined
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
  const { toc: enrichedToc, ttsMap, ttsTextMap, summary } = useDocumentEnrichments(documentId, chunks)

  // Prefer enriched TOC from Convex subscription over initial SSE value
  const toc = enrichedToc ?? initialToc

  const value = useMemo(
    () => ({ documentId, chunks, documentName, toc, ttsMap, ttsTextMap, summary }),
    [documentId, chunks, documentName, toc, ttsMap, ttsTextMap, summary],
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
