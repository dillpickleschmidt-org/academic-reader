import { useState, useRef, useEffect, memo, useMemo, useCallback, type ChangeEvent } from "react"
import { DefaultChatTransport, type UIMessage, type ChatStatus } from "ai"
import { useChat } from "@ai-sdk/react"
import { useQuery } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id, Doc } from "@repo/convex/convex/_generated/dataModel"
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
import { useStreamSubscription } from "@/hooks/use-stream-subscription"
import { authClient } from "@repo/convex/auth-client"

interface Props {
  onClose: () => void
}

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

function ThreadSelectionPlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <Bot className="h-8 w-8" />
      <p>Select a thread or click "New" to get started</p>
    </div>
  )
}

function convexMessagesToUI(messages: Doc<"chatMessages">[]): UIMessage[] {
  return messages.map((m) => ({
    id: m._id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }))
}

const ChatPromptInput = memo(function ChatPromptInput({
  onSendMessage,
  embeddingsReady,
  status,
}: {
  onSendMessage: (text: string) => void
  embeddingsReady: boolean
  status: ChatStatus
}) {
  const [input, setInput] = useState("")

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
    },
    [],
  )

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text) return
      onSendMessage(message.text)
      setInput("")
    },
    [onSendMessage],
  )

  return (
    <div className="border-t p-4">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={handleChange}
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
  )
})

export function AIChatPanel({ onClose }: Props) {
  const [embeddingsReady, setEmbeddingsReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const triggeredThreadsRef = useRef(new Set<string>())
  const isOriginatingRef = useRef(false)
  const { user, isLoading: configLoading } = useAppConfig()
  const chatPanel = useChatPanel()
  const { activeThreadId } = chatPanel
  const documentContext = useDocumentContext()
  const documentId = documentContext?.documentId

  // Load persisted messages for active thread
  const persistedMessages = useQuery(
    api.api.chat.listMessages,
    activeThreadId
      ? { threadId: activeThreadId as Id<"chatThreads"> }
      : "skip",
  )

  // Load thread to check isStreaming
  const activeThread = useQuery(
    api.api.chat.getThread,
    activeThreadId
      ? { threadId: activeThreadId as Id<"chatThreads"> }
      : "skip",
  )

  // Cross-device streaming subscription
  const streamingText = useStreamSubscription(
    activeThreadId,
    activeThread?.isStreaming ?? false,
    isOriginatingRef.current,
  )

  // Refs for transport closure
  const documentIdRef = useRef(documentId)
  const messagesRef = useRef<unknown[]>([])
  const activeThreadIdRef = useRef(activeThreadId)

  // Transport with document context and threadId
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      credentials: "same-origin",
      body: () => {
        const isFirstMessage = messagesRef.current.length === 0
        return {
          threadId: activeThreadIdRef.current ?? undefined,
          documentContext: {
            documentId: documentIdRef.current ?? undefined,
            isFirstMessage,
          },
        }
      },
    }),
  )

  const onFinish = useCallback(() => {
    isOriginatingRef.current = false
  }, [])

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transportRef.current,
    onFinish,
  })

  // Keep refs in sync
  documentIdRef.current = documentId
  messagesRef.current = messages
  activeThreadIdRef.current = activeThreadId

  // Sync persisted messages into useChat when thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([])
      return
    }
    if (persistedMessages) {
      setMessages(convexMessagesToUI(persistedMessages))
    }
  }, [activeThreadId, persistedMessages, setMessages])

  // Generate embeddings for document chunks
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
          // Response wasn't JSON
        }
        console.error("Failed to generate embeddings:", errorMessage)
        setStorageError("Failed to enable follow-up questions")
        return
      }

      const result = await response.json()
      setEmbeddingsReady(true)
      if (result.alreadyHasEmbeddings) {
        console.log("Document already has embeddings")
      }
    } catch (error) {
      console.error("Embedding generation error:", error)
      setStorageError("Failed to enable follow-up questions")
    }
  }

  // Auto-trigger summary when new thread starts
  const hasDocument = !!documentId
  useEffect(() => {
    if (configLoading) return
    if (!activeThreadId) return

    if (
      user &&
      hasDocument &&
      !triggeredThreadsRef.current.has(activeThreadId) &&
      messages.length === 0 &&
      persistedMessages !== undefined &&
      persistedMessages.length === 0
    ) {
      triggeredThreadsRef.current.add(activeThreadId)
      isOriginatingRef.current = true
      sendMessage({ text: "Please summarize this document." })
      generateEmbeddings()
    }
  }, [
    configLoading,
    user,
    hasDocument,
    messages.length,
    sendMessage,
    documentId,
    activeThreadId,
    persistedMessages,
  ])

  const handleClose = () => {
    setStorageError(null)
    setEmbeddingsReady(false)
    onClose()
  }

  const handleSendMessage = useCallback((text: string) => {
    isOriginatingRef.current = true
    sendMessage({ text })
  }, [sendMessage])

  // Build display messages: persisted + ephemeral streaming from other devices
  const displayMessages = useMemo(() => {
    if (streamingText) {
      const ephemeralMessage: UIMessage = {
        id: "streaming-ephemeral",
        role: "assistant",
        parts: [{ type: "text" as const, text: streamingText }],
      }
      return [...messages, ephemeralMessage]
    }
    return messages
  }, [messages, streamingText])

  const conversationFooter = useMemo(() => {
    const isLoading = status === "submitted" || status === "streaming"
    const isRemoteStreaming = !!streamingText
    if (!isLoading && !isRemoteStreaming && !storageError) return null
    return (
      <>
        {(isLoading || isRemoteStreaming) && <Loader />}
        {storageError && (
          <div className="text-sm text-amber-600">{storageError}</div>
        )}
      </>
    )
  }, [status, storageError, streamingText])

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
    <div className="flex h-full flex-col font-sans text-base" style={{ contain: "strict" }}>
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
            messages={displayMessages}
            className="flex-1"
            renderMessage={renderMessage}
            footer={conversationFooter}
          />

          <ChatPromptInput
            onSendMessage={handleSendMessage}
            embeddingsReady={embeddingsReady}
            status={status}
          />
        </div>
      )}
    </div>
  )
}
