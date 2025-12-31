/**
 * SSE stream transformation utilities.
 */

/**
 * Transform SSE events in a stream.
 * Parses SSE format, applies transform to event data, re-emits.
 */
export function transformSSEStream(
  input: ReadableStream<Uint8Array>,
  transform: (event: string, data: string) => string
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              const transformed = processSSEBlock(buffer, transform);
              if (transformed) {
                controller.enqueue(encoder.encode(transformed));
              }
            }
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE blocks (ending with \n\n)
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || ''; // Keep incomplete block in buffer

          for (const block of blocks) {
            if (!block.trim()) continue;
            const transformed = processSSEBlock(block, transform);
            if (transformed) {
              controller.enqueue(encoder.encode(transformed + '\n\n'));
            }
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Process a single SSE block, applying transform to data.
 */
function processSSEBlock(
  block: string,
  transform: (event: string, data: string) => string
): string {
  const lines = block.split('\n');
  let event = 'message';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data = line.slice(5).trim();
    }
  }

  if (!data) return block; // No data to transform

  const transformedData = transform(event, data);
  return `event: ${event}\ndata: ${transformedData}`;
}
