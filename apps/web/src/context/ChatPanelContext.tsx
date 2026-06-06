import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type {
  Id,
  Doc,
} from "@academic-reader/convex/convex/_generated/dataModel"
import { useDocumentContext } from "./DocumentContext"

type ViewMode = "all" | "document"
type ThreadListItem = Doc<"chatThreads"> & {
  documentColor?: number
  documentName?: string
}

interface ChatPanelContextValue {
  isOpen: boolean
  activeThreadId: string | null
  pendingMessage: string | null
  setPendingMessage: (message: string | null) => void
  threads: ThreadListItem[] | undefined
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  open: () => void
  selectThread: (threadId: string) => void
  startNewThread: () => void
  deleteThread: (threadId: string) => Promise<void>
  close: () => void
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null)

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("document")
  const documentContext = useDocumentContext()
  const documentId = documentContext?.documentId ?? null

  const allThreads = useQuery(
    api.api.chat.listAllThreads,
    viewMode === "all" ? {} : "skip",
  )
  const documentThreads = useQuery(
    api.api.chat.listThreadsForDocument,
    viewMode === "document" && documentId
      ? { documentId: documentId as Id<"documents"> }
      : "skip",
  )

  const threads = useMemo(() => {
    if (viewMode === "all") return allThreads
    if (documentId === null) return []
    return documentThreads
  }, [allThreads, documentThreads, viewMode, documentId])

  const createThreadMutation = useMutation(api.api.chat.createThread)
  const deleteThreadMutation = useMutation(api.api.chat.deleteThread)

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const selectThread = useCallback((threadId: string) => {
    setIsOpen(true)
    setActiveThreadId(threadId)
  }, [])

  const startNewThread = useCallback(async () => {
    if (!documentId) return
    const threadId = await createThreadMutation({
      documentId: documentId as Id<"documents">,
    })
    setIsOpen(true)
    setActiveThreadId(threadId)
  }, [documentId, createThreadMutation])

  const deleteThread = useCallback(
    async (threadId: string) => {
      await deleteThreadMutation({
        threadId: threadId as Id<"chatThreads">,
      })
      setActiveThreadId((prev) => (prev === threadId ? null : prev))
    },
    [deleteThreadMutation],
  )

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const value = useMemo(
    () => ({
      isOpen,
      activeThreadId,
      pendingMessage,
      setPendingMessage,
      threads,
      viewMode,
      setViewMode,
      open,
      selectThread,
      startNewThread,
      deleteThread,
      close,
    }),
    [
      isOpen,
      activeThreadId,
      pendingMessage,
      threads,
      viewMode,
      open,
      selectThread,
      startNewThread,
      deleteThread,
      close,
    ],
  )

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  )
}

export function useChatPanel() {
  const context = useContext(ChatPanelContext)
  if (!context) {
    throw new Error("useChatPanel must be used within a ChatPanelProvider")
  }
  return context
}
