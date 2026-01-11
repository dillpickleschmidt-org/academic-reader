import { Fragment, useState, useRef, useEffect, type ReactElement } from "react"
import { DefaultChatTransport } from "ai"
import { useChat } from "@ai-sdk/react"
import { LogIn } from "lucide-react"
import type { ChunkBlock } from "@repo/core/client/api-client"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/core/ui/primitives/dialog"
import { Button } from "@repo/core/ui/primitives/button"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/core/ui/ai-elements/conversation"
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
  chunks?: ChunkBlock[]
  filename?: string
}

export function AIChat({ trigger, markdown, chunks, filename }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const hasTriggeredRef = useRef(false)
  const { user, isLoading: configLoading } = useAppConfig()

  // Refs for transport closure (initialized with defaults, updated after useChat)
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
    })
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transportRef.current,
  })

  // Keep refs in sync with current values
  documentIdRef.current = documentId
  markdownRef.current = markdown
  messagesRef.current = messages

  // Store document in background (parallel with summary)
  const storeDocument = async () => {
    if (!chunks || chunks.length === 0 || !filename) return

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          filename,
          chunks,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error("Failed to store document:", error)
        setStorageError("Failed to enable follow-up questions")
        return
      }

      const result = await response.json()
      setDocumentId(result.documentId)
    } catch (error) {
      console.error("Document storage error:", error)
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

      // Send summary request (body() will set hasSentSummaryRef)
      sendMessage({
        text: "Please summarize this document.",
      })

      // Store document in parallel (for RAG follow-ups)
      storeDocument()
    }
  }, [open, user, markdown, messages.length, sendMessage])

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      hasTriggeredRef.current = false
      setMessages([])
      setInput("")
      setStorageError(null)
    }
  }

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text) return

    sendMessage({ text: message.text })
    setInput("")
    // hasSentSummaryRef is updated in body() when needed
  }

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
            <Conversation className="flex-1">
              <ConversationContent>
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.parts.map((part, i) => {
                      switch (part.type) {
                        case "text":
                          return (
                            <Fragment key={`${message.id}-${i}`}>
                              <Message from={message.role}>
                                <MessageContent>
                                  <MessageResponse>{part.text}</MessageResponse>
                                </MessageContent>
                              </Message>
                            </Fragment>
                          )
                        case "tool-invocation":
                          // Show searching indicator for RAG tool calls
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
                ))}
                {(status === "submitted" || status === "streaming") && (
                  <Loader />
                )}
                {storageError && (
                  <div className="px-4 py-2 text-sm text-amber-600">
                    {storageError}
                  </div>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="border-t p-4">
              <PromptInput onSubmit={handleSubmit}>
                <PromptInputBody>
                  <PromptInputTextarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      documentId
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
