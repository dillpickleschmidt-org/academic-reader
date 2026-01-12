import { useState, useRef, useEffect, memo, useMemo, useCallback, type ReactElement } from "react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useChat } from "@ai-sdk/react"
import { LogIn } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/core/ui/primitives/dialog"
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
import { authClient } from "@repo/convex/auth-client"

interface Props {
  trigger: ReactElement
  markdown?: string
  documentId?: string | null // Set at conversion completion for authenticated users
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

export function AIChat({ trigger, markdown, documentId: propDocumentId }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  // Track whether embeddings have been generated for this document
  const [embeddingsReady, setEmbeddingsReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const hasTriggeredRef = useRef(false)
  const { user, isLoading: configLoading } = useAppConfig()

  // Refs for transport closure (initialized with defaults, updated after useChat)
  const documentIdRef = useRef(propDocumentId)
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
    })
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transportRef.current,
  })

  // Keep refs in sync with current values
  documentIdRef.current = propDocumentId
  markdownRef.current = markdown
  messagesRef.current = messages

  // Generate embeddings for document chunks (enables RAG for follow-up questions)
  const generateEmbeddings = async () => {
    if (!propDocumentId) return

    try {
      const response = await fetch(`/api/documents/${propDocumentId}/embeddings`, {
        method: "POST",
        credentials: "same-origin",
      })

      if (!response.ok) {
        const error = await response.json()
        console.error("Failed to generate embeddings:", error)
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

  // Auto-trigger summary when dialog opens (if signed in + has markdown)
  useEffect(() => {
    if (
      open &&
      user &&
      markdown &&
      !hasTriggeredRef.current &&
      messages.length === 0
    ) {
      hasTriggeredRef.current = true

      // Defer to next frame - lets dialog fully render and paint first
      const rafId = requestAnimationFrame(() => {
        sendMessage({ text: "Please summarize this document." })
        // Generate embeddings for follow-up questions (if document was persisted)
        if (propDocumentId) {
          generateEmbeddings().catch(() => {
            // Error already handled in generateEmbeddings via setStorageError
          })
        }
      })

      return () => cancelAnimationFrame(rafId)
    }
  }, [open, user, markdown, messages.length, sendMessage, propDocumentId])

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      hasTriggeredRef.current = false
      setMessages([])
      setInput("")
      setStorageError(null)
      setEmbeddingsReady(false)
    }
  }

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text) return

    sendMessage({ text: message.text })
    setInput("")
    // hasSentSummaryRef is updated in body() when needed
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

  // Auth prompt for non-signed-in users
  const AuthPrompt = () => (
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
      <Button onClick={handleSignIn} className="mt-2">
        Sign in with Google
      </Button>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="flex h-[80vh] max-h-200 w-full max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>AI Chat</DialogTitle>
        </DialogHeader>

        {configLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader />
          </div>
        ) : !user ? (
          <AuthPrompt />
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
      </DialogContent>
    </Dialog>
  )
}
