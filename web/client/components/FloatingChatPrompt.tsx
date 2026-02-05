import { useState, useEffect, useCallback, type ChangeEvent } from "react"
import { Bot } from "lucide-react"
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@repo/core/ui/ai-elements/prompt-input"
import { useSidebar } from "@repo/core/ui/primitives/sidebar"
import { useIsMobile } from "@repo/core/hooks/use-mobile"
import { useChatPanel } from "@/context/ChatPanelContext"

const SUGGESTIONS = [
  "What's the main argument of this paper?",
  "Explain this to me as if I have low IQ.",
  "Who should read this paper and why?",
]

export function FloatingChatPrompt({ visible }: { visible: boolean }) {
  const [input, setInput] = useState("")
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [fade, setFade] = useState(true)
  const { setPendingMessage, startNewThread } = useChatPanel()
  const { setOpen: setSidebarOpen } = useSidebar()
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!visible || input) return
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setSuggestionIndex((i) => (i + 1) % SUGGESTIONS.length)
        setFade(true)
      }, 300)
    }, 4000)
    return () => clearInterval(interval)
  }, [visible, input])

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }, [])

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text) return
      setPendingMessage(message.text)
      startNewThread()
      if (!isMobile) setSidebarOpen(true)
      setInput("")
    },
    [setPendingMessage, startNewThread],
  )

  return (
    <div
      className={`absolute bottom-6 left-1/2 z-10 w-full max-w-md -translate-x-1/2 rounded-xl border border-border/75 bg-background p-1.5 shadow-lg transition-all duration-300 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={handleChange}
            placeholder=" "
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit disabled={!input} />
        </PromptInputFooter>
      </PromptInput>
      {!input && (
        <div
          className={`pointer-events-none absolute left-[17px] top-[15px] flex items-center gap-1.5 text-sm text-muted-foreground transition-opacity duration-300 ${fade ? "opacity-100" : "opacity-0"}`}
        >
          <Bot className="size-4 shrink-0 -translate-y-0.5" />
          <span>{SUGGESTIONS[suggestionIndex]}</span>
        </div>
      )}
    </div>
  )
}
