import { createContext, useContext, type ReactNode } from "react"
import type { ChunkBlock } from "@repo/core/types/api"

interface DocumentContextValue {
  markdown: string | undefined
  documentId: string | null
  chunks: ChunkBlock[] | undefined
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps {
  markdown: string | undefined
  documentId: string | null
  chunks: ChunkBlock[] | undefined
  children: ReactNode
}

export function DocumentProvider({
  markdown,
  documentId,
  chunks,
  children,
}: DocumentProviderProps) {
  return (
    <DocumentContext.Provider value={{ markdown, documentId, chunks }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocumentContext() {
  return useContext(DocumentContext)
}
