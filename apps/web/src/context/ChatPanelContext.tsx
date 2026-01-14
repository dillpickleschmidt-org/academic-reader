import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"

interface ChatPanelContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null)

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <ChatPanelContext.Provider value={{ isOpen, open, close }}>
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
