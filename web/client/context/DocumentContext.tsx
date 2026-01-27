import { createContext, useContext, type ReactNode } from "react"
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
  return (
    <DocumentContext.Provider value={{ documentId, chunks, documentName, toc }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocumentContext() {
  return useContext(DocumentContext)
}
