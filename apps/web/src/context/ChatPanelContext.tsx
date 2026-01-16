import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"

interface ChatPanelContextValue {
  isOpen: boolean
  activeThreadId: string | null
  open: () => void
  startNewThread: () => void
  close: () => void
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null)

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const startNewThread = useCallback(() => {
    setIsOpen(true)
    setActiveThreadId(crypto.randomUUID())
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setActiveThreadId(null)
  }, [])

  return (
    <ChatPanelContext.Provider
      value={{ isOpen, activeThreadId, open, startNewThread, close }}
    >
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
