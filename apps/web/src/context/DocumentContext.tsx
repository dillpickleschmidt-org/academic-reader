import { createContext, useContext, type ReactNode } from "react"

interface DocumentContextValue {
  markdown: string
  documentId: string | null
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

interface DocumentProviderProps {
  markdown: string
  documentId: string | null
  children: ReactNode
}

export function DocumentProvider({
  markdown,
  documentId,
  children,
}: DocumentProviderProps) {
  return (
    <DocumentContext.Provider value={{ markdown, documentId }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocumentContext() {
  return useContext(DocumentContext)
}
