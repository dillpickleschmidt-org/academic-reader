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
  const mappingRef = useRef<Map<number, number>>(new Map())
  const gapRangesRef = useRef<GapRange[]>([])
  const spansRef = useRef<Element[]>([])
  const currentRangeRef = useRef<HighlightRange | null>(null)
  const rafIdRef = useRef<number>(0)
  const wordTimestampsRef = useRef(wordTimestamps)
  wordTimestampsRef.current = wordTimestamps

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
    }

    const originalWords = spansRef.current.map((s) => s.textContent || "")
    const spokenWords = wordTimestamps.map((t) => t.word)
    const { mapping, gapRanges } = buildMapping(originalWords, spokenWords)
    mappingRef.current = mapping
    gapRangesRef.current = gapRanges

    const animate = () => {
      const currentMs = getPlaybackTime() * 1000 - HIGHLIGHT_DELAY_MS
      const timestamps = wordTimestampsRef.current

      const spokenIndex = timestamps.findIndex(
        (w) => currentMs >= w.startMs && currentMs < w.endMs,
      )

      let range: HighlightRange | null = null
      if (spokenIndex >= 0) {
        const directMatch = mappingRef.current.get(spokenIndex)
        if (directMatch !== undefined) {
          range = { start: directMatch, end: directMatch }
        } else {
          const gap = gapRangesRef.current.find(
            (g) => spokenIndex >= g.spokenStart && spokenIndex <= g.spokenEnd,
          )
          if (gap) {
            range = { start: gap.origStart, end: gap.origEnd }
          }
        }
      }

      if (spokenIndex >= 0 && !rangesEqual(range, currentRangeRef.current)) {
        if (currentRangeRef.current) {
          for (
            let i = currentRangeRef.current.start;
            i <= currentRangeRef.current.end;
            i++
          ) {
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
  }, [blockId, text, wordTimestamps, isPlaying, getPlaybackTime])
}

const NEARBY_THRESHOLD = 3
const SEQ_LENGTH = 3

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
