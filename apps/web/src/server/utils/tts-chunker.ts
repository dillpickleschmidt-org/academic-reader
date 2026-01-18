/**
 * TTS text chunking utility.
 * Splits text into segments ≤ maxChars while respecting sentence boundaries.
 */

export interface TextChunk {
  index: number
  text: string
}

/**
 * Split text into chunks for TTS synthesis.
 *
 * Rules (in order of preference):
 * 1. Never exceed maxChars (default 300)
 * 2. Prefer breaking at sentence endings (. ! ?)
 * 3. Fallback to comma, semicolon, or colon
 * 4. Last resort: break at space nearest to maxChars
 * 5. Trim whitespace from each chunk
 */
export function chunkTextForTTS(
  text: string,
  maxChars: number = 300,
): TextChunk[] {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim()

  if (!normalized) {
    return []
  }

  if (normalized.length <= maxChars) {
    return [{ index: 0, text: normalized }]
  }

  const chunks: TextChunk[] = []
  let remaining = normalized

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push({ index: chunks.length, text: remaining.trim() })
      break
    }

    // Find the best break point within maxChars
    const breakPoint = findBreakPoint(remaining, maxChars)

    const chunk = remaining.slice(0, breakPoint).trim()
    if (chunk) {
      chunks.push({ index: chunks.length, text: chunk })
    }

    remaining = remaining.slice(breakPoint).trim()
  }

  return chunks
}

/**
 * Find the best break point within the given limit.
 */
function findBreakPoint(text: string, maxChars: number): number {
  const searchRange = text.slice(0, maxChars)

  // Strategy 1: Find last sentence ending (. ! ?) followed by space or end
  const sentenceMatch = searchRange.match(/.*[.!?](?=\s|$)/s)
  if (sentenceMatch && sentenceMatch[0].length >= maxChars * 0.3) {
    // Only use if we get at least 30% of max to avoid tiny chunks
    return sentenceMatch[0].length
  }

  // Strategy 2: Find last clause break (, ; :) followed by space
  const clauseMatch = searchRange.match(/.*[,;:](?=\s)/s)
  if (clauseMatch && clauseMatch[0].length >= maxChars * 0.5) {
    // Only use if we get at least 50% of max
    return clauseMatch[0].length
  }

  // Strategy 3: Find last space
  const lastSpace = searchRange.lastIndexOf(" ")
  if (lastSpace > maxChars * 0.3) {
    return lastSpace
  }

  // Strategy 4: Hard break at maxChars (shouldn't happen with normal text)
  return maxChars
}

/**
 * Estimate total duration for chunks based on typical speech rate.
 * ~150 words per minute, ~5 chars per word average.
 */
export function estimateDurationMs(chunks: TextChunk[]): number {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const words = totalChars / 5
  const minutes = words / 150
  return Math.round(minutes * 60 * 1000)
}
