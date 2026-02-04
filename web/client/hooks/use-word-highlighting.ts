import { useEffect, useRef } from "react"
import { useAudioSelector, useGetPlaybackTime } from "@/context/AudioContext"
import { originalHtmlMap, wrapWordsInSpans } from "@/utils/tts-word-wrapping"

const HIGHLIGHT_DELAY_MS = 0

/**
 * Hook for word-level highlighting during TTS playback.
 * Uses requestAnimationFrame with direct player time reads for per-frame
 * precision, and direct DOM manipulation to avoid React re-renders.
 */
export function useWordHighlighting() {
  const blockId = useAudioSelector((s) => s.playback.blockId)
  const text = useAudioSelector((s) => s.playback.text)
  const wordTimestamps = useAudioSelector((s) => s.playback.wordTimestamps)
  const isPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const getPlaybackTime = useGetPlaybackTime()

  const blockElementRef = useRef<HTMLElement | null>(null)
  const originalHtmlRef = useRef<string>("")
  const spansRef = useRef<Element[]>([])
  const rangesRef = useRef<(HighlightRange | null)[]>([])
  const currentRangeRef = useRef<HighlightRange | null>(null)
  const lastIndexRef = useRef(0)
  const rafIdRef = useRef<number>(0)
  const wordTimestampsRef = useRef(wordTimestamps)
  wordTimestampsRef.current = wordTimestamps

  // Rebuild ranges when timestamps change without restarting the RAF loop
  const prevTimestampsRef = useRef(wordTimestamps)
  if (wordTimestamps !== prevTimestampsRef.current && spansRef.current.length > 0) {
    prevTimestampsRef.current = wordTimestamps
    const originalWords = spansRef.current.map((s) => s.textContent || "")
    const spokenWords = wordTimestamps.map((t) => t.word)
    rangesRef.current = buildRanges(originalWords, spokenWords)
  }

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
      spansRef.current = []
      rangesRef.current = []
      currentRangeRef.current = null
      lastIndexRef.current = 0
    }

    if (!blockId || !isPlaying || !text) {
      cleanup()
      return
    }

    const blockEl = document.querySelector(`[data-block-id="${blockId}"]`)
    if (!blockEl) return

    const isSameBlock = blockEl === blockElementRef.current

    if (!isSameBlock) {
      blockElementRef.current = blockEl as HTMLElement
      originalHtmlRef.current =
        originalHtmlMap.get(blockElementRef.current) ?? blockEl.innerHTML

      if (!blockEl.querySelector("[data-word-index]")) {
        wrapWordsInSpans(blockEl)
      }

      spansRef.current = Array.from(
        blockElementRef.current.querySelectorAll("[data-word-index]"),
      )
      currentRangeRef.current = null

      // Initial range build after DOM setup
      if (wordTimestamps?.length) {
        const originalWords = spansRef.current.map((s) => s.textContent || "")
        const spokenWords = wordTimestamps.map((t) => t.word)
        rangesRef.current = buildRanges(originalWords, spokenWords)
        prevTimestampsRef.current = wordTimestamps
      }
    }

    const animate = () => {
      const currentMs = getPlaybackTime() * 1000 - HIGHLIGHT_DELAY_MS
      const timestamps = wordTimestampsRef.current
      const ranges = rangesRef.current

      let spokenIndex = -1
      for (let i = Math.max(0, lastIndexRef.current - 1); i < timestamps.length; i++) {
        if (timestamps[i].startMs > currentMs) break
        if (currentMs >= timestamps[i].startMs && currentMs < timestamps[i].endMs) {
          spokenIndex = i
          lastIndexRef.current = i
          break
        }
      }

      const range = spokenIndex >= 0 ? ranges[spokenIndex] ?? null : null

      if (spokenIndex >= 0 && !rangesEqual(range, currentRangeRef.current)) {
        if (currentRangeRef.current) {
          for (let i = currentRangeRef.current.start; i <= currentRangeRef.current.end; i++) {
            spansRef.current[i]?.classList.remove("tts-word-active")
          }
        }
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
  }, [blockId, text, isPlaying, getPlaybackTime])
}

// --- Types ---

type HighlightRange = { start: number; end: number }

// --- Precomputation ---

const NEARBY_THRESHOLD = 3
const SEQ_LENGTH = 3

function buildRanges(
  originalWords: string[],
  spokenWords: string[],
): (HighlightRange | null)[] {
  const normOrig = originalWords.map(normalizeWord)
  const normSpoken = spokenWords.map(normalizeWord)
  const mapping = alignWordIndices(normSpoken, normOrig)
  const gapRanges = detectGapRanges(mapping)

  const ranges: (HighlightRange | null)[] = new Array(spokenWords.length).fill(null)

  for (const [spokenIdx, origIdx] of mapping) {
    ranges[spokenIdx] = { start: origIdx, end: origIdx }
  }

  for (const gap of gapRanges) {
    for (let i = gap.spokenStart; i <= gap.spokenEnd; i++) {
      ranges[i] = { start: gap.origStart, end: gap.origEnd }
    }
  }

  return ranges
}

// --- Word alignment ---

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

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "")
}

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

function detectGapRanges(
  mapping: Map<number, number>,
): { spokenStart: number; spokenEnd: number; origStart: number; origEnd: number }[] {
  const ranges: { spokenStart: number; spokenEnd: number; origStart: number; origEnd: number }[] = []
  const entries = Array.from(mapping.entries()).sort((a, b) => a[0] - b[0])

  for (let i = 0; i < entries.length - 1; i++) {
    const [spokenIdx, origIdx] = entries[i]
    const [nextSpokenIdx, nextOrigIdx] = entries[i + 1]

    const spokenGapStart = spokenIdx + 1
    const spokenGapEnd = nextSpokenIdx - 1
    const origGapStart = origIdx + 1
    const origGapEnd = nextOrigIdx - 1

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
