import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { ChunkBlock, TocResult } from "@repo/core/types/api"

interface DocumentContextValue {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  toc: TocResult | undefined
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
  toc,
  children,
}: DocumentProviderProps) {
  const value = useMemo(
    () => ({ documentId, chunks, documentName, toc }),
    [documentId, chunks, documentName, toc],
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
