import { useCallback } from "react"
import { ensureWordsWrapped } from "@/utils/tts-word-wrapping"

export function useTTSChunkDetection(
  eligibleBlockIds: Set<string> | undefined,
  onWordClick: (blockId: string, wordIndex: number | null) => void,
) {
  const handleContentClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      const element = target.closest("[data-block-id]")
      const blockId = element?.getAttribute("data-block-id")

      if (!blockId || !element) return

      const blockEl = element as HTMLElement
      if (eligibleBlockIds === undefined) {
        blockEl.style.cursor = "progress"
        setTimeout(() => {
          blockEl.style.cursor = ""
        }, 500)
        return
      }

      if (!eligibleBlockIds.has(blockId) || !blockEl.textContent?.trim()) return

      ensureWordsWrapped(blockEl)

      let wordSpan = target.closest("[data-word-index]") as HTMLElement | null
      if (!wordSpan) {
        const freshTarget = document.elementFromPoint(
          event.clientX,
          event.clientY,
        )
        wordSpan = freshTarget?.closest(
          "[data-word-index]",
        ) as HTMLElement | null
      }

      if (!wordSpan) return

      const wordIndexAttr = wordSpan.getAttribute("data-word-index")
      const wordIndex = wordIndexAttr ? parseInt(wordIndexAttr, 10) : null
      onWordClick(blockId, wordIndex)
    },
    [eligibleBlockIds, onWordClick],
  )

  return { handleContentClick }
}
