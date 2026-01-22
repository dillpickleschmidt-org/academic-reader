import { useEffect, useRef } from "react"
import { useAudioSelector, useAudioRef } from "@/context/AudioContext"
import { splitWords } from "@/utils/tts-words"
import { originalHtmlMap, wrapWordsInSpans } from "@/utils/tts-word-wrapping"
import type { TTSSegment } from "@/audio/types"

/**
 * Hook for word-level highlighting during TTS playback.
 * Uses requestAnimationFrame for ~16ms precision and direct DOM manipulation
 * to avoid React re-renders.
 */
export function useWordHighlighting() {
  const currentBlockId = useAudioSelector((s) => s.playback.currentBlockId)
  const currentSegmentIndex = useAudioSelector(
    (s) => s.playback.currentSegmentIndex,
  )
  const segments = useAudioSelector((s) => s.playback.segments)
  const isPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const audioRef = useAudioRef()

  const blockElementRef = useRef<HTMLElement | null>(null)
  const originalHtmlRef = useRef<string>("")
  // Combined mapping (combined reworded index → original index) + segment offsets + gaps
  const combinedMappingRef = useRef<Map<number, number>>(new Map())
  const segmentOffsetsRef = useRef<number[]>([])
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
      combinedMappingRef.current = new Map()
      segmentOffsetsRef.current = []
      gapRangesRef.current = []
      spansRef.current = []
      currentRangeRef.current = null
    }

    if (!currentBlockId || !isPlaying) {
      cleanup()
      return
    }

    const segment = segments[currentSegmentIndex]
    if (!segment?.wordTimestamps?.length || !segment.text) return

    const blockEl = document.querySelector(
      `[data-block-id="${currentBlockId}"]`,
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

      // Build combined mapping: spoken words → original words, greedy first-unused match
      const originalWords = spansRef.current.map((s) => s.textContent || "")
      const { mapping, offsets, gapRanges } = buildCombinedMapping(
        originalWords,
        segments,
      )
      combinedMappingRef.current = mapping
      segmentOffsetsRef.current = offsets
      gapRangesRef.current = gapRanges
    }

    const audio = audioRef.current
    if (!audio) return

    const timestamps = segment.wordTimestamps

    const animate = () => {
      const currentMs = audio.currentTime * 1000

      // Start 50ms early for better perceived sync
      const rewordedIndex = timestamps.findIndex(
        (w) => currentMs >= Math.max(0, w.startMs - 50) && currentMs < w.endMs,
      )

      let range: HighlightRange | null = null
      if (rewordedIndex >= 0) {
        const offset = segmentOffsetsRef.current[currentSegmentIndex] ?? 0
        const combinedIdx = offset + rewordedIndex

        // Check direct mapping first
        const directMatch = combinedMappingRef.current.get(combinedIdx)
        if (directMatch !== undefined) {
          range = { start: directMatch, end: directMatch }
        } else {
          // Check gap ranges for block highlighting
          const gap = gapRangesRef.current.find(
            (g) => combinedIdx >= g.spokenStart && combinedIdx <= g.spokenEnd,
          )
          if (gap) {
            range = { start: gap.origStart, end: gap.origEnd }
          }
        }
      }

      // Update DOM only if range changed (and we're on a word, not between words)
      if (rewordedIndex >= 0 && !rangesEqual(range, currentRangeRef.current)) {
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
  }, [currentBlockId, currentSegmentIndex, segments, isPlaying, audioRef])
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

export function buildCombinedMapping(
  originalWords: string[],
  segments: TTSSegment[],
): { mapping: Map<number, number>; offsets: number[]; gapRanges: GapRange[] } {
  const mapping = new Map<number, number>()
  const offsets: number[] = []
  const normOrig = originalWords.map(normalizeWord)
  const used = new Set<number>()

  let combinedIdx = 0
  let cursor = 0 // Expected position in original

  for (const segment of segments) {
    offsets.push(combinedIdx)
    const spokenWords = getSpokenWords(segment)
    if (spokenWords.length === 0) continue

    const normSpoken = spokenWords.map(normalizeWord)
    const result = alignWordIndicesWithState(normSpoken, normOrig, used, cursor)

    for (const [spokenIdx, origIdx] of result.mapping) {
      mapping.set(combinedIdx + spokenIdx, origIdx)
    }

    used.clear()
    for (const usedIndex of result.usedIndices) {
      used.add(usedIndex)
    }

    combinedIdx += normSpoken.length
    cursor = result.cursor
  }

  const gapRanges = detectGapRanges(mapping)
  return { mapping, offsets, gapRanges }
}

export function alignWordIndices(
  spokenWords: string[],
  originalWords: string[],
): Map<number, number> {
  const normSpoken = spokenWords.map(normalizeWord)
  const normOrig = originalWords.map(normalizeWord)
  const result = alignWordIndicesWithState(normSpoken, normOrig, new Set(), 0)
  return result.mapping
}

// --- Helper functions ---

/**
 * Normalize a word for comparison: lowercase, letters and apostrophes only.
 */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "")
}

function getSpokenWords(segment: TTSSegment): string[] {
  if (segment.wordTimestamps?.length) {
    return segment.wordTimestamps.map((t) => t.word)
  }
  return splitWords(segment.text)
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

type AlignmentResult = {
  mapping: Map<number, number>
  usedIndices: Set<number>
  cursor: number
}

function alignWordIndicesWithState(
  spoken: string[],
  orig: string[],
  used: Set<number>,
  cursor: number,
): AlignmentResult {
  const mapping = new Map<number, number>()
  const usedIndices = new Set<number>(used)
  let nextCursor = cursor

  for (let i = 0; i < spoken.length; i++) {
    const word = spoken[i]
    if (!word) continue

    let match = -1
    for (let j = nextCursor; j < orig.length; j++) {
      if (usedIndices.has(j) || word !== orig[j]) continue

      const distance = j - nextCursor
      if (distance < NEARBY_THRESHOLD) {
        match = j
        break
      }

      // Distance 5+: require 3-word sequence
      if (matchesSequence(spoken, i, orig, j, usedIndices, SEQ_LENGTH)) {
        match = j
        break
      }
    }

    if (match >= 0) {
      mapping.set(i, match)
      usedIndices.add(match)
      nextCursor = match + 1
    }
  }

  return { mapping, usedIndices, cursor: nextCursor }
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
