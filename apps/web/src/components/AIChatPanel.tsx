import { useState, useRef, useEffect, memo, useMemo, useCallback } from "react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useChat } from "@ai-sdk/react"
import { Bot, LogIn, X } from "lucide-react"
import { Button } from "@repo/core/ui/primitives/button"
import { VirtualizedConversation } from "@repo/core/ui/ai-elements/virtualized-conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@repo/core/ui/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@repo/core/ui/ai-elements/prompt-input"
import { Loader } from "@repo/core/ui/ai-elements/loader"
import { useAppConfig } from "@/hooks/use-app-config"
import { useDocumentContext } from "@/context/DocumentContext"
import { useChatPanel } from "@/context/ChatPanelContext"
import { authClient } from "@repo/convex/auth-client"

interface Props {
  onClose: () => void
}

// Memoized message component to prevent re-renders during streaming
const ChatMessage = memo(
  function ChatMessage({ message }: { message: UIMessage }) {
    return (
      <div>
        {message.parts.map((part, i) => {
          switch (part.type) {
            case "text":
              return (
                <Message key={`${message.id}-${i}`} from={message.role}>
                  <MessageContent>
                    <MessageResponse>{part.text}</MessageResponse>
                  </MessageContent>
                </Message>
              )
            case "tool-invocation":
              if ("toolName" in part && part.toolName === "searchDocument") {
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="px-4 py-2 text-sm text-muted-foreground"
                  >
                    Searching document...
                  </div>
                )
              }
              return null
            default:
              return null
          }
        })}
      </div>
    )
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.parts === next.message.parts,
)

// Auth prompt for non-signed-in users
function AuthPrompt({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-muted p-4">
        <LogIn className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Sign in to use AI Chat</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Get AI-powered summaries and ask questions about your documents.
        </p>
      </div>
      <Button onClick={onSignIn} className="mt-2">
        Sign in with Google
      </Button>
    </div>
  )
}

// Placeholder when no thread is selected
function ThreadSelectionPlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <Bot className="h-8 w-8" />
      <p>Select a thread or click "New" to get started</p>
    </div>
  )
}

export function AIChatPanel({ onClose }: Props) {
  const [input, setInput] = useState("")
  // Track whether embeddings have been generated for this document
  const [embeddingsReady, setEmbeddingsReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const hasTriggeredRef = useRef(false)
  const { user, isLoading: configLoading } = useAppConfig()
  const { activeThreadId } = useChatPanel()
  const documentContext = useDocumentContext()
  const markdown = documentContext?.markdown
  const documentId = documentContext?.documentId

  // Refs for transport closure
  const documentIdRef = useRef(documentId)
  const markdownRef = useRef(markdown)
  const messagesRef = useRef<unknown[]>([])

  // Transport with document context (created once, uses refs for fresh values)
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      credentials: "same-origin",
      body: () => {
        // First message = summary mode (send full markdown)
        const isFirstMessage = messagesRef.current.length === 0
        return {
          documentContext: {
            markdown: isFirstMessage ? markdownRef.current : undefined,
            documentId: documentIdRef.current ?? undefined,
            isFirstMessage,
          },
        }
      },
    }),
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transportRef.current,
  })

  // Keep refs in sync with current values
  documentIdRef.current = documentId
  markdownRef.current = markdown
  messagesRef.current = messages

  // Generate embeddings for document chunks (enables RAG for follow-up questions)
  const generateEmbeddings = async () => {
    if (!documentId) return

    try {
      const response = await fetch(`/api/documents/${documentId}/embeddings`, {
        method: "POST",
        credentials: "same-origin",
      })

      if (!response.ok) {
        let errorMessage = "Unknown error"
        try {
          const error = await response.json()
          errorMessage = error.message || JSON.stringify(error)
        } catch {
          // Response wasn't JSON (HTML error page, etc.)
        }
        console.error("Failed to generate embeddings:", errorMessage)
        setStorageError("Failed to enable follow-up questions")
        return
      }

      const result = await response.json()
      // If already had embeddings or successfully generated, mark ready
      setEmbeddingsReady(true)
      if (result.alreadyHasEmbeddings) {
        console.log("Document already has embeddings")
      }
    } catch (error) {
      console.error("Embedding generation error:", error)
      setStorageError("Failed to enable follow-up questions")
    }
  }

  // Reset trigger flag when thread changes
  useEffect(() => {
    hasTriggeredRef.current = false
  }, [activeThreadId])

  // Auto-trigger summary when new thread starts (if signed in + has markdown)
  const hasMarkdown = !!markdown
  useEffect(() => {
    if (configLoading) return
    if (!activeThreadId) return // No thread = no auto-trigger

    if (
      user &&
      hasMarkdown &&
      !hasTriggeredRef.current &&
      messages.length === 0
    ) {
      hasTriggeredRef.current = true
      sendMessage({ text: "Please summarize this document." })

      // Generate embeddings for follow-up questions (if document was persisted)
      if (documentId) {
        generateEmbeddings()
      }
    }
  }, [
    configLoading,
    user,
    hasMarkdown,
    messages.length,
    sendMessage,
    documentId,
    activeThreadId,
  ])

  // Reset state when panel closes
  const handleClose = () => {
    hasTriggeredRef.current = false
    setMessages([])
    setInput("")
    setStorageError(null)
    setEmbeddingsReady(false)
    onClose()
  }

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text) return

    sendMessage({ text: message.text })
    setInput("")
  }

  // Memoize footer to prevent recreation on every render
  const conversationFooter = useMemo(() => {
    const isLoading = status === "submitted" || status === "streaming"
    if (!isLoading && !storageError) return null
    return (
      <>
        {isLoading && <Loader />}
        {storageError && (
          <div className="text-sm text-amber-600">{storageError}</div>
        )}
      </>
    )
  }, [status, storageError])

  // Stable renderMessage callback
  const renderMessage = useCallback(
    (message: UIMessage) => <ChatMessage message={message} />,
    [],
  )

  const handleSignIn = async () => {
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.href,
      })
    } catch (error) {
      console.error("Sign in failed:", error)
    }
  }

  return (
    <div className="flex h-full flex-col font-sans text-base">
      <header className="flex items-center justify-between border-b pl-4 pr-32 py-5.5">
        <h2 className="text-sm font-semibold">AI Chat</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      {configLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader />
        </div>
      ) : !user ? (
        <AuthPrompt onSignIn={handleSignIn} />
      ) : !activeThreadId ? (
        <ThreadSelectionPlaceholder />
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <VirtualizedConversation
            messages={messages}
            className="flex-1"
            renderMessage={renderMessage}
            footer={conversationFooter}
          />

          <div className="border-t p-4">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputBody>
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    embeddingsReady
                      ? "Ask a follow-up question..."
                      : "Ask a question..."
                  }
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  {/* Model selector, web search, etc. */}
                </PromptInputTools>
                <PromptInputSubmit
                  disabled={!input && status !== "streaming"}
                  status={status}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </div>
  )
}
