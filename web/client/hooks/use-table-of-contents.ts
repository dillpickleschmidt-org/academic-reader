import { useState, useEffect, useMemo } from "react"
import type { TocResult } from "@repo/core/client/api-client"

export interface TocDisplayItem {
  id: string
  title: string
  displayPage?: number
  children?: TocDisplayItem[]
}

/**
 * Hook for table of contents display.
 * Returns undefined when TOC is still processing (show loading state).
 * Prefers server-provided TOC with page numbers, falls back to DOM-based h1/h2 extraction.
 */
export function useTableOfContents(
  serverToc: TocResult | undefined,
  hasDocumentId: boolean,
): TocDisplayItem[] | undefined {
  const [domItems, setDomItems] = useState<TocDisplayItem[]>([])
  const hasServerToc = Boolean(serverToc?.sections.length)

  // If we have a documentId but no TOC yet, it's still processing
  const isProcessing = hasDocumentId && serverToc === undefined

  // DOM-based fallback extraction (only runs if no server TOC and not processing)
  useEffect(() => {
    if (hasServerToc || isProcessing) return

    const extractHeaders = () => {
      const container = document.querySelector(".reader-content")
      if (!container) return

      const headers = container.querySelectorAll("h1, h2")
      const items: TocDisplayItem[] = []

      headers.forEach((header, index) => {
        if (!header.id) {
          header.id = `toc-${index}`
        }
        items.push({
          id: header.id,
          title: header.textContent?.trim() || "",
        })
      })

      setDomItems(items)
    }

    const timer = setTimeout(extractHeaders, 100)
    return () => clearTimeout(timer)
  }, [hasServerToc, isProcessing])

  return useMemo(() => {
    if (isProcessing) return undefined

    if (!serverToc?.sections.length) {
      return domItems
    }

    return serverToc.sections.map((section) => {
      const item: TocDisplayItem = {
        id: section.id,
        title: section.title,
        displayPage: section.page - serverToc.offset,
      }

      if (section.children?.length) {
        item.children = section.children.map((child) => ({
          id: child.id,
          title: child.title,
          displayPage: child.page - serverToc.offset,
        }))
      }

      return item
    })
  }, [serverToc, domItems, isProcessing])
}
