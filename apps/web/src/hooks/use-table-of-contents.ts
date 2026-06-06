import { useState, useEffect, useMemo } from "react"
import type { TocResult } from "@academic-reader/api-client/schemas/document"

export interface TocDisplayItem {
  id: string
  title: string
  displayPage?: number
  children?: TocDisplayItem[]
}

export function useTableOfContents(
  serverToc: TocResult | null | undefined,
  hasDocumentId: boolean,
): TocDisplayItem[] | undefined {
  const [domItems, setDomItems] = useState<TocDisplayItem[]>([])
  const hasServerToc = Boolean(serverToc?.sections.length)
  const isProcessing = hasDocumentId && serverToc === null
  const isLoading = hasDocumentId && serverToc === undefined

  // DOM-based fallback extraction only runs once server TOC extraction is done
  useEffect(() => {
    if (hasServerToc || isProcessing || isLoading) return

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
  }, [hasServerToc, isProcessing, isLoading])

  return useMemo(() => {
    if (isProcessing || isLoading) return undefined

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
  }, [serverToc, domItems, isProcessing, isLoading])
}
