type CompletedTransformResult =
  | string
  | { eventType: string; data: string }

export function transformSSEStream(
  inputStream: ReadableStream<Uint8Array>,
  syncTransform: (event: string, data: string) => string,
  asyncCompletedHandler: (data: string) => Promise<CompletedTransformResult>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ""
  let completedData: string | null = null
  let completedEvent: string | null = null

  return new ReadableStream({
    async start(controller) {
      const reader = inputStream.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() ?? ""

          for (const block of blocks) {
            if (!block.trim()) continue

            const lines = block.split("\n")
            let eventType = ""
            const dataLines: string[] = []

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim()
              } else if (line.startsWith("data: ")) {
                dataLines.push(line.slice(6))
              } else if (line.startsWith(":")) {
                controller.enqueue(encoder.encode(`${line}\n\n`))
              }
            }

            if (!eventType && dataLines.length === 0) continue

            const data = dataLines.join("\n")

            if (eventType === "completed") {
              completedData = data
              completedEvent = eventType
            } else {
              const transformed = syncTransform(eventType, data)
              controller.enqueue(
                encoder.encode(`event: ${eventType}\ndata: ${transformed}\n\n`),
              )
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (completedData !== null && completedEvent !== null) {
        controller.enqueue(
          encoder.encode(
            `event: progress\ndata: ${JSON.stringify({ stage: "Processing", current: 0, total: 0 })}\n\n`,
          ),
        )

        const result = await asyncCompletedHandler(completedData)
        const eventType = typeof result === "string" ? completedEvent : result.eventType
        const data = typeof result === "string" ? result : result.data
        controller.enqueue(
          encoder.encode(
            `event: ${eventType}\ndata: ${data}\n\n`,
          ),
        )
      }

      controller.close()
    },
  })
}
