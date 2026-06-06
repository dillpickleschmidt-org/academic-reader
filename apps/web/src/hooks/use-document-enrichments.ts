import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id } from "@academic-reader/convex/convex/_generated/dataModel"
import type { TocResult } from "@academic-reader/api-client/schemas/document"

export function useDocumentEnrichments(documentId: string | null) {
  const typedId = documentId as Id<"documents"> | null

  const doc = useQuery(
    api.api.documents.get,
    typedId ? { documentId: typedId } : "skip",
  )

  const toc: TocResult | null | undefined = doc === undefined ? undefined : doc.toc
  const summary: string | undefined = doc?.summary ?? undefined

  return { toc, summary }
}
