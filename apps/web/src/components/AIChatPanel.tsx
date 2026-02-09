import {
  useState,
  useRef,
  useEffect,
  memo,
  useMemo,
  useCallback,
  type ChangeEvent,
} from "react"
import "katex/dist/katex.min.css"
import { DefaultChatTransport, type UIMessage, type ChatStatus } from "ai"
import { useChat } from "@ai-sdk/react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id, Doc } from "@academic-reader/convex/convex/_generated/dataModel"

import {
  Bot,
  LogIn,
  X,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Pencil,
} from "lucide-react"
import { Button } from "@academic-reader/ui/primitives/button"
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@academic-reader/ui/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@academic-reader/ui/ai-elements/prompt-input"
import { Loader } from "@academic-reader/ui/ai-elements/loader"
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@academic-reader/ui/ai-elements/sources"
import { triggerEmbeddings } from "@academic-reader/api-client/client"
import { useAppConfig } from "@/hooks/use-app-config"
import { useDocumentContext } from "@/context/DocumentContext"
import { useChatPanel } from "@/context/ChatPanelContext"
import { useStreamSubscription } from "@/hooks/use-stream-subscription"
import { authClient } from "@academic-reader/convex/auth-client"
import { AppRuntime } from "@/lib/runtime"

type ToolPart = Extract<
  Doc<"chatMessages">["parts"][number],
  { toolCallId: string }
>

interface Props {
  onClose: () => void
}

// Convert single-dollar LaTeX ($...$) to double-dollar ($$...$$) for Streamdown
function convertLatex(text: string): string {
  // Match $...$ but not $$...$$ (already double) or escaped \$
  return text.replace(/(?<!\$)\$(?!\$)([^$]+?)\$(?!\$)/g, "$$$$$1$$$$")
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }, [text])

  return (
    <MessageAction tooltip="Copy" onClick={handleCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </MessageAction>
  )
}

interface ChatMessageProps {
  message: UIMessage
  isLastAssistant?: boolean
  isActive?: boolean
  onRetry?: (message: UIMessage) => void
  onEdit?: (message: UIMessage) => void
}

const ChatMessage = memo(
  function ChatMessage({
    message,
    isLastAssistant,
    isActive,
    onRetry,
    onEdit,
  }: ChatMessageProps) {
    return (
      <div>
        {message.parts.map((part, i) => {
          switch (part.type) {
            case "text":
              return (
                <Message key={`${message.id}-${i}`} from={message.role}>
                  <MessageContent className="md:text-[15px]">
                    <MessageResponse>{convertLatex(part.text)}</MessageResponse>
                  </MessageContent>
                  <MessageActions className="group-[.is-user]:ml-auto">
                    <CopyAction text={part.text} />
                    {message.role === "assistant" &&
                      isLastAssistant &&
                      onRetry && (
                        <MessageAction
                          tooltip="Retry"
                          onClick={() => onRetry(message)}
                          disabled={isActive}
                        >
                          <RefreshCw className="size-3.5" />
                        </MessageAction>
                      )}
                    {message.role === "user" && onEdit && (
                      <MessageAction
                        tooltip="Edit"
                        onClick={() => onEdit(message)}
                        disabled={isActive}
                      >
                        <Pencil className="size-3.5" />
                      </MessageAction>
                    )}
                  </MessageActions>
                </Message>
              )
            default: {
              const toolPart = part as ToolPart
              if (toolPart.type === "tool-searchDocument") {
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground"
                  >
                    {toolPart.state !== "output-available" && (
                      <Loader size={14} />
                    )}
                    Searching document...
                  </div>
                )
              }
              if (toolPart.type === "tool-webSearch") {
                const query = toolPart.input?.query
                if (toolPart.state === "output-available") {
                  const { results } = toolPart.output
                  return (
                    <div key={`${message.id}-${i}`} className="px-4 py-2">
                      <Sources>
                        <SourcesTrigger count={results.length} />
                        <SourcesContent>
                          {results.map((r) => (
                            <Source key={r.url} href={r.url} title={r.title} />
                          ))}
                        </SourcesContent>
                      </Sources>
                    </div>
                  )
                }
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground"
                  >
                    <Loader size={14} />
                    {query ? `Searching "${query}"...` : "Searching the web..."}
                  </div>
                )
              }
              if (toolPart.type === "tool-extractPage") {
                if (toolPart.state !== "output-available") {
                  return (
                    <div
                      key={`${message.id}-${i}`}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground"
                    >
                      <Loader size={14} />
                      Reading page...
                    </div>
                  )
                }
                return null
              }
              return null
            }
          }
        })}
      </div>
    )
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.parts === next.message.parts &&
    prev.isLastAssistant === next.isLastAssistant &&
    prev.isActive === next.isActive,
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
    parts: m.parts as UIMessage["parts"],
  }))
}

const ChatPromptInput = memo(function ChatPromptInput({
  input,
  onInputChange,
  onSendMessage,
  embeddingsReady,
  status,
}: {
  input: string
  onInputChange: (value: string) => void
  onSendMessage: (text: string) => void
  embeddingsReady: boolean
  status: ChatStatus
}) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onInputChange(e.target.value)
    },
    [onInputChange],
  )

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text) return
      onSendMessage(message.text)
      onInputChange("")
    },
    [onSendMessage, onInputChange],
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
  const [chatInput, setChatInput] = useState("")
  const [embeddingsReady, setEmbeddingsReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const embeddingsTriggeredRef = useRef(new Set<string>())
  const { user, isLoading: configLoading } = useAppConfig()
  const chatPanel = useChatPanel()
  const { activeThreadId, pendingMessage, setPendingMessage } = chatPanel
  const documentContext = useDocumentContext()
  const documentId = documentContext?.documentId
  const summary = documentContext?.summary

  // Load thread and messages together
  const threadData = useQuery(
    api.api.chat.getThreadMessages,
    activeThreadId ? { threadId: activeThreadId as Id<"chatThreads"> } : "skip",
  )
  const activeThread = threadData?.thread
  const persistedMessages = threadData?.messages

  const deleteMessagesFrom = useMutation(api.api.chat.deleteMessagesFrom)

  // Refs for transport closure
  const documentIdRef = useRef(documentId)
  const summaryRef = useRef(summary)
  const messagesRef = useRef<unknown[]>([])
  const activeThreadIdRef = useRef(activeThreadId)

  // Transport with document context and threadId
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      credentials: "same-origin",
      body: () => ({
        threadId: activeThreadIdRef.current ?? undefined,
        documentContext: {
          documentId: documentIdRef.current ?? undefined,
          summary: summaryRef.current ?? undefined,
        },
      }),
    }),
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: transportRef.current,
  })

  // Cross-device streaming subscription
  const streamingText = useStreamSubscription(
    activeThreadId,
    activeThread?.isStreaming ?? false,
    status !== "ready",
  )

  // Keep refs in sync
  documentIdRef.current = documentId
  summaryRef.current = summary
  messagesRef.current = messages
  activeThreadIdRef.current = activeThreadId
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage

  // Sync persisted messages into useChat when idle (during streaming, useChat is the authority)
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([])
      return
    }
    if (status !== "ready") return
    if (persistedMessages) {
      setMessages(convexMessagesToUI(persistedMessages))
    }
  }, [activeThreadId, persistedMessages, setMessages, status])

  // Generate embeddings when a thread is first opened
  const hasDocument = !!documentId
  useEffect(() => {
    if (!activeThreadId || !hasDocument || !user) return
    if (embeddingsTriggeredRef.current.has(activeThreadId)) return
    embeddingsTriggeredRef.current.add(activeThreadId)

    AppRuntime.runPromise(triggerEmbeddings(documentId!))
      .then(() => setEmbeddingsReady(true))
      .catch(() => setStorageError("Failed to enable follow-up questions"))
  }, [activeThreadId, hasDocument, documentId, user])

  // Auto-send pending message from floating prompt
  const pendingSentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingMessage || !activeThreadId) return
    if (pendingSentRef.current === pendingMessage) return
    pendingSentRef.current = pendingMessage
    sendMessageRef.current({ text: pendingMessage })
    setPendingMessage(null)
  }, [pendingMessage, activeThreadId, setPendingMessage])

  const handleClose = () => {
    setStorageError(null)
    setEmbeddingsReady(false)
    onClose()
  }

  const handleSendMessage = useCallback(
    (text: string) => {
      sendMessage({ text })
    },
    [sendMessage],
  )

  const isActive = status === "streaming" || status === "submitted"

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id
    }
    return undefined
  }, [messages])

  const handleRetry = useCallback(
    async (assistantMessage: UIMessage) => {
      if (!activeThreadId || isActive) return

      const assistantIndex = messages.findIndex(
        (m) => m.id === assistantMessage.id,
      )
      if (assistantIndex === -1) return

      const userMessage = messages[assistantIndex - 1]
      if (!userMessage || userMessage.role !== "user") return

      const userText = userMessage.parts.find((p) => p.type === "text")
      if (!userText || userText.type !== "text") return

      setMessages(messages.slice(0, assistantIndex - 1))
      try {
        await deleteMessagesFrom({
          threadId: activeThreadId as Id<"chatThreads">,
          messageId: userMessage.id as Id<"chatMessages">,
        })
      } catch {
        return
      }
      sendMessage({ text: userText.text })
    },
    [
      activeThreadId,
      isActive,
      messages,
      setMessages,
      deleteMessagesFrom,
      sendMessage,
    ],
  )

  const handleEdit = useCallback(
    async (message: UIMessage) => {
      if (!activeThreadId || isActive) return

      const targetIndex = messages.findIndex((m) => m.id === message.id)
      if (targetIndex === -1) return

      const text = message.parts.find((p) => p.type === "text")
      if (!text || text.type !== "text") return

      setMessages(messages.slice(0, targetIndex))
      try {
        await deleteMessagesFrom({
          threadId: activeThreadId as Id<"chatThreads">,
          messageId: message.id as Id<"chatMessages">,
        })
      } catch {
        return
      }
      setChatInput(text.text)
    },
    [activeThreadId, isActive, messages, setMessages, deleteMessagesFrom],
  )

  // Reversed messages for flex-col-reverse layout (memoized separately from streaming)
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages])

  // Ephemeral streaming message (rendered first due to flex-col-reverse = appears at bottom)
  const ephemeralMessage = streamingText
    ? {
        id: "streaming-ephemeral",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: streamingText }],
      }
    : null

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
    <div
      className="flex h-full flex-col font-sans text-base"
      style={{ contain: "strict" }}
    >
      <header className="flex items-center justify-between border-b pl-4 pr-32 py-5.5">
        <h2 className="text-[15px] font-semibold">AI Chat</h2>
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
          <div className="flex flex-col-reverse flex-1 overflow-y-auto">
            {conversationFooter && (
              <div className="p-4">{conversationFooter}</div>
            )}
            {ephemeralMessage && (
              <div key={ephemeralMessage.id} className="px-4 pt-4">
                <ChatMessage message={ephemeralMessage} />
              </div>
            )}
            {reversedMessages.map((message) => (
              <div
                key={message.id}
                className="px-4 pt-4"
                style={
                  reversedMessages.length > 50
                    ? {
                        contentVisibility: "auto",
                        containIntrinsicSize:
                          message.role === "user"
                            ? "auto 142px"
                            : "auto 1346px",
                      }
                    : undefined
                }
              >
                <ChatMessage
                  message={message}
                  isLastAssistant={message.id === lastAssistantId}
                  isActive={isActive}
                  onRetry={handleRetry}
                  onEdit={handleEdit}
                />
              </div>
            ))}
            {summary === undefined && documentId && (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Generating summary...
              </div>
            )}
            {summary && (
              <div className="p-4">
                <Message from="assistant">
                  <MessageContent className="md:text-[15px]">
                    <MessageResponse>{convertLatex(summary)}</MessageResponse>
                  </MessageContent>
                </Message>
              </div>
            )}
          </div>

          <ChatPromptInput
            input={chatInput}
            onInputChange={setChatInput}
            onSendMessage={handleSendMessage}
            embeddingsReady={embeddingsReady}
            status={status}
          />
        </div>
      )}
    </div>
  )
}
