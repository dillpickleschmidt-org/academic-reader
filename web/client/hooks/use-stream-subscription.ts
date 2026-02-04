import { useState, useEffect, useRef } from "react"

export function useStreamSubscription(
  threadId: string | null,
  isStreaming: boolean,
  isOriginating: boolean,
) {
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!threadId || !isStreaming || isOriginating) {
      setStreamingText(null)
      return
    }

    const es = new EventSource(`/api/chat/stream/${threadId}`)
    eventSourceRef.current = es
    let accumulated = ""

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === "token") {
          accumulated += data.text
          setStreamingText(accumulated)
        } else if (data.type === "done" || data.type === "error") {
          es.close()
          setStreamingText(null)
        }
      } catch {
        // Ignore malformed messages
      }
    }

    es.onerror = () => {
      es.close()
      setStreamingText(null)
    }

    return () => {
      es.close()
      eventSourceRef.current = null
      setStreamingText(null)
    }
  }, [threadId, isStreaming, isOriginating])

  return streamingText
}
