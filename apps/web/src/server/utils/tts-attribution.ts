/**
 * TTS chunk attribution - adds data-page and data-block-id attributes to HTML elements.
 * Uses inverted word index for O(element_words) matching.
 */
import type { CheerioAPI } from "cheerio"

interface ChunkForAttribution {
  blockId: string
  content: string
  page: number
}

interface ChunkMatch {
  blockId: string
  page: number
}

/** Extract words (4+ chars) from text */
function extractWords(text: string): string[] {
  return text.toLowerCase().match(/\b\w{4,}\b/g) || []
}

/** Build inverted index: word → chunk indices that contain it */
function buildWordIndex(chunks: ChunkForAttribution[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i < chunks.length; i++) {
    for (const word of extractWords(chunks[i].content)) {
      if (!index.has(word)) index.set(word, [])
      index.get(word)!.push(i)
    }
  }
  return index
}

/** Find best matching chunk for text using vote counting */
function findBestChunk(
  index: Map<string, number[]>,
  chunks: ChunkForAttribution[],
  text: string,
): ChunkMatch | null {
  const words = extractWords(text)
  if (words.length < 3) return null

  const votes = new Map<number, number>()
  for (const word of words) {
    const chunkIndices = index.get(word)
    if (chunkIndices) {
      for (const idx of chunkIndices) {
        votes.set(idx, (votes.get(idx) || 0) + 1)
      }
    }
  }

  let bestIdx: number | null = null
  let bestVotes = 0
  for (const [idx, count] of votes) {
    if (count > bestVotes) {
      bestIdx = idx
      bestVotes = count
    }
  }

  // Require at least 3 matching words
  if (bestVotes < 3 || bestIdx === null) return null

  const chunk = chunks[bestIdx]
  return { blockId: chunk.blockId, page: chunk.page }
}

/**
 * Add data-page and data-block-id attributes to content elements based on chunk similarity.
 * Mutates the cheerio instance in place.
 */
export function addPageAttributes($: CheerioAPI, chunks: ChunkForAttribution[]): void {
  if (!chunks.length) return

  const wordIndex = buildWordIndex(chunks)

  // Process content elements
  $("p, h1, h2, h3, h4, h5, h6, li").each(function () {
    const $el = $(this)
    const text = $el.text()

    const match = findBestChunk(wordIndex, chunks, text)
    if (match) {
      $el.attr("data-page", String(match.page))
      $el.attr("data-block-id", match.blockId)
    }
  })
}
