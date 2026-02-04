import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id, Doc } from "@repo/convex/convex/_generated/dataModel"
import { useDocumentContext } from "./DocumentContext"

interface ChatPanelContextValue {
  isOpen: boolean
  activeThreadId: string | null
  threads: Doc<"chatThreads">[] | undefined
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
  const documentContext = useDocumentContext()
  const documentId = documentContext?.documentId

  const threads = useQuery(
    api.api.chat.listThreads,
    documentId ? { documentId: documentId as Id<"documents"> } : "skip",
  )

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
      threads,
      open,
      selectThread,
      startNewThread,
      deleteThread,
      close,
    }),
    [
      isOpen,
      activeThreadId,
      threads,
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
