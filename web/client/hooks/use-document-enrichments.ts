import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import type { ChunkBlock, TocResult } from "@repo/core/types/api"

/**
 * Subscribe to deferred document enrichments (TOC + TTS flags) via Convex.
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

  // Only subscribe to TTS flags when enrichment hasn't completed yet
  const needsTtsSubscription = propChunks?.length
    ? propChunks.every((c) => c.includeTts === undefined)
    : false

  const ttsFlags = useQuery(
    api.api.documents.getTtsFlags,
    typedId && needsTtsSubscription ? { documentId: typedId } : "skip",
  )

  const toc: TocResult | undefined = doc?.toc
  const summary: string | undefined = doc?.summary

  const ttsMap = useMemo(() => {
    // Prefer Convex subscription data when available, otherwise use prop chunks
    if (ttsFlags) {
      if (ttsFlags.every((f) => f.includeTts === undefined)) return undefined
      const map = new Map<string, boolean>()
      for (const f of ttsFlags) {
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
  }, [ttsFlags, propChunks])

  return { toc, ttsMap, summary }
}
