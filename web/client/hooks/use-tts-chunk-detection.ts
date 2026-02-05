import { useCallback, useMemo, useState } from "react"
import type { ChunkBlock } from "@repo/core/types/api"
import { ensureWordsWrapped } from "@/utils/tts-word-wrapping"

export interface TTSMenuState {
  isOpen: boolean
  anchorElement: HTMLElement | null
  blockId: string | null
  wordIndex: number | null
  chunkContent: string
}

const initialMenuState: TTSMenuState = {
  isOpen: false,
  anchorElement: null,
  blockId: null,
  wordIndex: null,
  chunkContent: "",
}

/**
 * Hook for detecting which chunk a clicked element belongs to
 * and showing a context menu for TTS playback.
 */
export function useTTSChunkDetection(
  chunks: ChunkBlock[],
  ttsMap: Map<string, boolean> | undefined,
) {
  const [menuState, setMenuState] = useState<TTSMenuState>(initialMenuState)

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
   * Opens context menu for TTS playback at clicked word.
   */
  const handleContentClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      const element = target.closest("[data-block-id]")
      const blockId = element?.getAttribute("data-block-id")

      if (!blockId) {
        // Click outside readable content - close menu
        setMenuState(initialMenuState)
        return
      }

      const chunk = chunkMap.get(blockId)
      if (!chunk) {
        console.warn(`[TTS] Chunk not found for blockId: ${blockId}`)
        return
      }

      // TTS map not yet loaded — show brief progress cursor
      if (ttsMap === undefined) {
        const blockEl = element as HTMLElement
        blockEl.style.cursor = "progress"
        setTimeout(() => {
          blockEl.style.cursor = ""
        }, 500)
        return
      }

      if (!ttsMap.get(blockId)) {
        return
      }

      const chunkContent = chunk.html.replace(/<[^>]*>/g, "")
      if (!chunkContent.trim()) return

      // Ensure words are wrapped for word-level detection
      ensureWordsWrapped(element!)

      // Check if a word was clicked (look for data-word-index)
      // Re-resolve click target after wrapping in case spans were just created
      let wordSpan = target.closest("[data-word-index]") as HTMLElement | null
      if (!wordSpan) {
        const freshTarget = document.elementFromPoint(event.clientX, event.clientY)
        wordSpan = freshTarget?.closest("[data-word-index]") as HTMLElement | null
      }

      if (!wordSpan) {
        // Click on block but not on a word - close menu
        setMenuState(initialMenuState)
        return
      }

      const wordIndexAttr = wordSpan.getAttribute("data-word-index")
      const wordIndex = wordIndexAttr ? parseInt(wordIndexAttr, 10) : null

      setMenuState({
        isOpen: true,
        anchorElement: wordSpan,
        blockId,
        wordIndex,
        chunkContent,
      })
    },
    [chunkMap, ttsMap],
  )

  const setMenuOpen = useCallback((open: boolean) => {
    if (!open) {
      setMenuState(initialMenuState)
    } else {
      setMenuState((prev) => ({ ...prev, isOpen: true }))
    }
  }, [])

  return { menuState, setMenuOpen, handleContentClick }
}
