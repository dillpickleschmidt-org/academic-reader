import { useCallback, useMemo } from "react"
import type { ChunkBlock } from "@repo/core/types/api"
import { useAudioSelector, useAudioActions } from "@/context/AudioContext"
import { ensureWordsWrapped } from "@/utils/tts-word-wrapping"

// Block types to skip for TTS (from Marker BlockTypes enum)
// These contain non-readable content (images, tables, page furniture)
const SKIP_BLOCK_TYPES = new Set([
  "Picture",
  "Figure",
  "PictureGroup",
  "FigureGroup",
  "Table",
  "TableGroup",
  "TableCell",
  "PageHeader",
  "PageFooter",
  "TableOfContents",
  "Form",
])

/**
 * Hook for detecting which chunk a clicked element belongs to
 * and triggering TTS for that chunk's content.
 */
export function useTTSChunkDetection(chunks: ChunkBlock[]) {
  const isEnabled = useAudioSelector((s) => s.narrator.isEnabled)
  const { loadBlockTTS } = useAudioActions()

  // Build lookup map: blockId -> chunk
  const chunkMap = useMemo(() => {
    const map = new Map<string, ChunkBlock>()
    for (const chunk of chunks) {
      map.set(chunk.id, chunk)
    }
    return map
  }, [chunks])

  /**
   * Handle click on reader content.
   * Reads data-block-id attribute and triggers TTS for that chunk.
   * If a specific word is clicked, uses that word as the starting point.
   */
  const handleContentClick = useCallback(
    (event: React.MouseEvent) => {
      if (!isEnabled) return

      const target = event.target as HTMLElement
      const element = target.closest("[data-block-id]")
      const blockId = element?.getAttribute("data-block-id")

      if (!blockId) return

      const chunk = chunkMap.get(blockId)
      if (!chunk) {
        console.warn(`[TTS] Chunk not found for blockId: ${blockId}`)
        return
      }

      // Skip non-readable block types
      if (SKIP_BLOCK_TYPES.has(chunk.block_type)) {
        return
      }

      const chunkContent = chunk.html.replace(/<[^>]*>/g, "")
      if (!chunkContent.trim()) return

      // Ensure words are wrapped for word-level detection
      ensureWordsWrapped(element!)

      // Check if a word was clicked (look for data-word-index)
      // Re-resolve click target after wrapping in case spans were just created
      let wordSpan = target.closest("[data-word-index]")
      if (!wordSpan) {
        const freshTarget = document.elementFromPoint(event.clientX, event.clientY)
        wordSpan = freshTarget?.closest("[data-word-index]") ?? null
      }
      const wordIndex = wordSpan?.getAttribute("data-word-index")

      loadBlockTTS(
        blockId,
        chunkContent,
        wordIndex ? { wordIndex: parseInt(wordIndex, 10) } : undefined,
      )
    },
    [isEnabled, chunkMap, loadBlockTTS],
  )

  return { handleContentClick }
}
