import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import type { ChunkBlock, TocResult } from "@repo/core/types/api"

/**
 * Subscribe to deferred document enrichments (TOC, TTS, summary) via Convex.
 * Skips the chunks subscription when prop data already has includeTts populated
 * (i.e. saved documents with completed enrichments).
 */
export function useDocumentEnrichments(
  documentId: string | null,
  propChunks: ChunkBlock[] | undefined,
) {
  const typedId = documentId as Id<"documents"> | null

  const doc = useQuery(
    api.api.documents.get,
    typedId ? { documentId: typedId } : "skip",
  )

  // Only subscribe to TTS enrichments when enrichment hasn't completed yet
  const needsTtsSubscription = propChunks?.length
    ? propChunks.every((c) => c.includeTts === undefined)
    : false

  const ttsEnrichments = useQuery(
    api.api.documents.getTtsEnrichments,
    typedId && needsTtsSubscription ? { documentId: typedId } : "skip",
  )

  const toc: TocResult | undefined = doc?.toc
  const summary: string | undefined = doc?.summary

  const ttsMap = useMemo(() => {
    // Prefer Convex subscription data when available, otherwise use prop chunks
    if (ttsEnrichments) {
      if (ttsEnrichments.every((f) => f.includeTts === undefined)) return undefined
      const map = new Map<string, boolean>()
      for (const f of ttsEnrichments) {
        map.set(f.blockId, f.includeTts ?? true)
      }
      return map
    }

    if (!propChunks?.length) return undefined
    if (propChunks.every((c) => c.includeTts === undefined)) return undefined
    const map = new Map<string, boolean>()
    for (const c of propChunks) {
      map.set(c.id, c.includeTts ?? true)
    }
    return map
  }, [ttsEnrichments, propChunks])

  const ttsTextMap = useMemo(() => {
    if (ttsEnrichments) {
      const map = new Map<string, string>()
      for (const f of ttsEnrichments) {
        if (f.ttsText) map.set(f.blockId, f.ttsText)
      }
      return map.size > 0 ? map : undefined
    }

    if (!propChunks?.length) return undefined
    const map = new Map<string, string>()
    for (const c of propChunks) {
      if (c.ttsText) map.set(c.id, c.ttsText)
    }
    return map.size > 0 ? map : undefined
  }, [ttsEnrichments, propChunks])

  return { toc, ttsMap, ttsTextMap, summary }
}
