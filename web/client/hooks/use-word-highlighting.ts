import { useEffect, useRef } from "react"
import { useAudioSelector } from "@/context/AudioContext"
import { originalHtmlMap, wrapWordsInSpans } from "@/utils/tts-word-wrapping"

/**
 * Hook for word-level highlighting during TTS playback.
 * Uses requestAnimationFrame for ~16ms precision and direct DOM manipulation
 * to avoid React re-renders.
 */
export function useWordHighlighting() {
  const blockId = useAudioSelector((s) => s.playback.blockId)
  const text = useAudioSelector((s) => s.playback.text)
  const wordTimestamps = useAudioSelector((s) => s.playback.wordTimestamps)
  const isPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const currentTime = useAudioSelector((s) => s.playback.currentTime)

  const blockElementRef = useRef<HTMLElement | null>(null)
  const originalHtmlRef = useRef<string>("")
  // Mapping (spoken word index → original word index)
  const mappingRef = useRef<Map<number, number>>(new Map())
  const gapRangesRef = useRef<GapRange[]>([])
  // Cached spans for O(1) access during animation
  const spansRef = useRef<Element[]>([])
  const currentRangeRef = useRef<HighlightRange | null>(null)
  const rafIdRef = useRef<number>(0)

  useEffect(() => {
    const cleanup = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      if (blockElementRef.current && originalHtmlRef.current) {
        blockElementRef.current.innerHTML = originalHtmlRef.current
      }
      blockElementRef.current = null
      originalHtmlRef.current = ""
      mappingRef.current = new Map()
      gapRangesRef.current = []
      spansRef.current = []
      currentRangeRef.current = null
    }

    if (!blockId || !isPlaying || !wordTimestamps?.length || !text) {
      cleanup()
      return
    }

    const blockEl = document.querySelector(
      `[data-block-id="${blockId}"]`,
    )
    if (!blockEl) return

    const isSameBlock = blockEl === blockElementRef.current

    if (!isSameBlock) {
      blockElementRef.current = blockEl as HTMLElement
      originalHtmlRef.current =
        originalHtmlMap.get(blockElementRef.current) ?? blockEl.innerHTML

      // Check if already wrapped to prevent duplicate word indices
      if (!blockEl.querySelector("[data-word-index]")) {
        wrapWordsInSpans(blockEl)
      }

      spansRef.current = Array.from(
        blockElementRef.current.querySelectorAll("[data-word-index]"),
      )
      currentRangeRef.current = null

      // Build mapping: spoken words → original words
      const originalWords = spansRef.current.map((s) => s.textContent || "")
      const spokenWords = wordTimestamps.map((t) => t.word)
      const { mapping, gapRanges } = buildMapping(originalWords, spokenWords)
      mappingRef.current = mapping
      gapRangesRef.current = gapRanges
    }

    const animate = () => {
      const currentMs = currentTime * 1000

      // Start 50ms early for better perceived sync
      const spokenIndex = wordTimestamps.findIndex(
        (w) => currentMs >= Math.max(0, w.startMs - 50) && currentMs < w.endMs,
      )

      let range: HighlightRange | null = null
      if (spokenIndex >= 0) {
        // Check direct mapping first
        const directMatch = mappingRef.current.get(spokenIndex)
        if (directMatch !== undefined) {
          range = { start: directMatch, end: directMatch }
        } else {
          // Check gap ranges for block highlighting
          const gap = gapRangesRef.current.find(
            (g) => spokenIndex >= g.spokenStart && spokenIndex <= g.spokenEnd,
          )
          if (gap) {
            range = { start: gap.origStart, end: gap.origEnd }
          }
        }
      }

      // Update DOM only if range changed (and we're on a word, not between words)
      if (spokenIndex >= 0 && !rangesEqual(range, currentRangeRef.current)) {
        // Remove old highlights
        if (currentRangeRef.current) {
          for (
            let i = currentRangeRef.current.start;
            i <= currentRangeRef.current.end;
            i++
          ) {
            spansRef.current[i]?.classList.remove("tts-word-active")
          }
        }
        // Add new highlights
        if (range) {
          for (let i = range.start; i <= range.end; i++) {
            spansRef.current[i]?.classList.add("tts-word-active")
          }
        }
        currentRangeRef.current = range
      }

      rafIdRef.current = requestAnimationFrame(animate)
    }

    rafIdRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
      if (blockElementRef.current) {
        originalHtmlMap.delete(blockElementRef.current)
      }
    }
  }, [blockId, text, wordTimestamps, isPlaying, currentTime])
}

const NEARBY_THRESHOLD = 3 // Single word OK if within this distance
const SEQ_LENGTH = 3 // Required sequence for distant matches

type GapRange = {
  spokenStart: number
  spokenEnd: number
  origStart: number
  origEnd: number
}

type HighlightRange = { start: number; end: number }

function buildMapping(
  originalWords: string[],
  spokenWords: string[],
): { mapping: Map<number, number>; gapRanges: GapRange[] } {
  const normOrig = originalWords.map(normalizeWord)
  const normSpoken = spokenWords.map(normalizeWord)
  const mapping = alignWordIndices(normSpoken, normOrig)
  const gapRanges = detectGapRanges(mapping)
  return { mapping, gapRanges }
}

export function alignWordIndices(
  spokenWords: string[],
  originalWords: string[],
): Map<number, number> {
  const mapping = new Map<number, number>()
  const used = new Set<number>()
  let cursor = 0

  for (let i = 0; i < spokenWords.length; i++) {
    const word = spokenWords[i]
    if (!word) continue

    let match = -1
    for (let j = cursor; j < originalWords.length; j++) {
      if (used.has(j) || word !== originalWords[j]) continue

      const distance = j - cursor
      if (distance < NEARBY_THRESHOLD) {
        match = j
        break
      }

      // Distance 5+: require 3-word sequence
      if (matchesSequence(spokenWords, i, originalWords, j, used, SEQ_LENGTH)) {
        match = j
        break
      }
    }

    if (match >= 0) {
      mapping.set(i, match)
      used.add(match)
      cursor = match + 1
    }
  }

  return mapping
}

// --- Helper functions ---

/**
 * Normalize a word for comparison: lowercase, letters and apostrophes only.
 */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "")
}

/**
 * Check if N consecutive words match starting at given positions.
 */
function matchesSequence(
  spoken: string[],
  si: number,
  orig: string[],
  oi: number,
  used: Set<number>,
  len: number,
): boolean {
  for (let k = 0; k < len; k++) {
    if (si + k >= spoken.length || oi + k >= orig.length) return false
    if (used.has(oi + k) || spoken[si + k] !== orig[oi + k]) return false
  }
  return true
}

/**
 * Detect gaps: unmapped spoken words between two anchors with corresponding original gaps.
 */
function detectGapRanges(mapping: Map<number, number>): GapRange[] {
  const ranges: GapRange[] = []
  const entries = Array.from(mapping.entries()).sort((a, b) => a[0] - b[0])

  for (let i = 0; i < entries.length - 1; i++) {
    const [spokenIdx, origIdx] = entries[i]
    const [nextSpokenIdx, nextOrigIdx] = entries[i + 1]

    const spokenGapStart = spokenIdx + 1
    const spokenGapEnd = nextSpokenIdx - 1
    const origGapStart = origIdx + 1
    const origGapEnd = nextOrigIdx - 1

    // Gap exists if there are unmapped words on BOTH sides
    if (spokenGapEnd >= spokenGapStart && origGapEnd >= origGapStart) {
      ranges.push({
        spokenStart: spokenGapStart,
        spokenEnd: spokenGapEnd,
        origStart: origGapStart,
        origEnd: origGapEnd,
      })
    }
  }
  return ranges
}

function rangesEqual(
  a: HighlightRange | null,
  b: HighlightRange | null,
): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.start === b.start && a.end === b.end
}
