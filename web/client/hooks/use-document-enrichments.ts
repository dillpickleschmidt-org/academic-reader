import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import type { TocResult } from "@repo/core/types/api"

/**
 * Subscribe to deferred document enrichments (TOC + TTS flags) via Convex.
 * Returns undefined while still processing, resolved values when ready.
 */
export function useDocumentEnrichments(documentId: string | null) {
  const typedId = documentId as Id<"documents"> | null

  const doc = useQuery(
    api.api.documents.get,
    typedId ? { documentId: typedId } : "skip",
  )

  const chunks = useQuery(
    api.api.documents.getChunks,
    typedId ? { documentId: typedId } : "skip",
  )

  const toc: TocResult | undefined = doc?.toc

  const ttsMap = useMemo(() => {
    if (!chunks) return undefined
    if (chunks.every((c) => c.includeTts === undefined)) return undefined
    const map = new Map<string, boolean>()
    for (const c of chunks) {
      map.set(c.blockId, c.includeTts ?? true)
    }
    return map
  }, [chunks])

  return { toc, ttsMap }
}
