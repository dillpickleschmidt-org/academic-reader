import { createContext, useContext, type ReactNode } from "react"
import type { ChunkBlock } from "@repo/core/types/api"

interface DocumentContextValue {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps {
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  documentName: string | undefined
  children: ReactNode
}

export function DocumentProvider({
  documentId,
  chunks,
  documentName,
  children,
}: DocumentProviderProps) {
  return (
    <DocumentContext.Provider value={{ documentId, chunks, documentName }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocumentContext() {
  return useContext(DocumentContext)
}
