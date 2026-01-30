/**
 * TOC Extraction Service
 *
 * Extracts structured table of contents from converted documents using AI,
 * with smart page offset detection for accurate navigation.
 */

import * as mupdf from "mupdf"
import { generateObject } from "ai"
import { z } from "zod"
import { createChatModel } from "../providers/models"
import { tryCatch } from "../utils/try-catch"
import type { TocSection, TocResult } from "@repo/core/types/api"

export type { TocSection, TocResult }

export type TocStatus =
  | "success"
  | "no_toc_text"
  | "ai_failed"
  | "empty_sections"
  | "skipped" // No chunks or documentPath available
  | "pdf_read_failed" // Could not read PDF from storage
  | "error" // Uncaught exception

export interface TocExtractionMeta {
  status: TocStatus
  offsetDetected: boolean
}

interface RawTocEntry {
  title: string
  page: string
  children?: { title: string; page: string }[]
}

const TocSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      page: z.string(),
      children: z
        .array(
          z.object({
            title: z.string(),
            page: z.string(),
          }),
        )
        .optional(),
    }),
  ),
})

const TOC_SYSTEM_PROMPT = `You are a document analyzer. Extract the table of contents from the provided text.

Return JSON with this structure:
{
  "sections": [
    {
      "title": "Chapter 1: Introduction",
      "page": "15",
      "children": [
        { "title": "1.1 Background", "page": "15" },
        { "title": "1.2 Motivation", "page": "18" }
      ]
    }
  ]
}

Rules:
- Include only actual TOC entries, not the "Table of Contents" header itself
- page should be the number as written (string, may be roman numeral like "iv", "xii")
- children is optional, one level deep only (for subsections)
- Preserve the exact titles from the text
- If no clear TOC structure is found, return {"sections": []}`

export interface TocExtractionResult {
  toc: TocResult | null
  meta: TocExtractionMeta
}

/**
 * Main entry point - extracts structured TOC from converted text with page offset detection.
 * Tries PDF's built-in outline first, then falls back to AI-based extraction.
 */
export async function extractTableOfContents(
  convertedText: string,
  pdfBuffer: Buffer | Uint8Array,
): Promise<TocExtractionResult> {
  // Try PDF's built-in outline first (already has correct physical page numbers)
  const outlineSections = extractPdfOutline(pdfBuffer)
  if (outlineSections.length > 0) {
    return {
      toc: {
        sections: outlineSections,
        offset: 0,
        hasRomanNumerals: false,
      },
      meta: { status: "success", offsetDetected: true },
    }
  }

  // Fall back to AI-based extraction from converted text
  const tocText = findTocText(convertedText)
  if (!tocText) {
    return {
      toc: null,
      meta: { status: "no_toc_text", offsetDetected: false },
    }
  }

  // Generate structured TOC using AI
  const { sections: rawSections, failed: aiFailed } =
    await generateTocWithAI(tocText)
  if (aiFailed) {
    return {
      toc: null,
      meta: { status: "ai_failed", offsetDetected: false },
    }
  }
  if (!rawSections.length) {
    return {
      toc: null,
      meta: { status: "empty_sections", offsetDetected: false },
    }
  }

  // Detect if there are roman numerals (front matter)
  const hasRomanNumerals = rawSections.some(
    (s) =>
      isRomanNumeral(s.page) || s.children?.some((c) => isRomanNumeral(c.page)),
  )

  // Calculate page offset from first Arabic numeral entry
  const { offset, detected: offsetDetected } = calculatePageOffset(
    rawSections,
    pdfBuffer,
  )

  // Convert raw sections to final format with physical page numbers
  const sections = convertToTocSections(rawSections, offset)

  return {
    toc: {
      sections,
      offset,
      hasRomanNumerals,
    },
    meta: { status: "success", offsetDetected },
  }
}

interface PdfOutlineItem {
  title: string
  page?: number
  down?: PdfOutlineItem[]
}

/**
 * Extract TOC from PDF's built-in outline/bookmarks.
 * Returns sections with physical page numbers (1-indexed).
 */
function extractPdfOutline(pdfBuffer: Buffer | Uint8Array): TocSection[] {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
  try {
    const outline = doc.loadOutline() as PdfOutlineItem[] | null
    if (!outline || outline.length === 0) {
      return []
    }

    const sections: TocSection[] = []
    for (const item of outline) {
      // Skip items without page numbers
      if (item.page === undefined) continue

      // Convert 0-indexed to 1-indexed physical page
      const physicalPage = item.page + 1

      const section: TocSection = {
        id: `page-marker-${physicalPage}`,
        title: item.title,
        page: physicalPage,
      }

      // Process children (one level deep)
      if (item.down && item.down.length > 0) {
        section.children = item.down
          .filter((child) => child.page !== undefined)
          .map((child) => {
            const childPage = child.page! + 1
            return {
              id: `page-marker-${childPage}`,
              title: child.title,
              page: childPage,
            }
          })
      }

      sections.push(section)
    }

    return sections
  } catch {
    return []
  } finally {
    doc.destroy()
  }
}

/**
 * Search for "table of contents" in text and extract up to 30k chars around it.
 */
function findTocText(text: string): string | null {
  const lowerText = text.toLowerCase()
  const tocIndex = lowerText.indexOf("table of contents")

  if (tocIndex === -1) {
    // Try alternate patterns
    const contentsIndex = lowerText.indexOf("contents\n")
    if (contentsIndex === -1) {
      return null
    }
    // Extract from "contents" heading
    const start = Math.max(0, contentsIndex)
    const end = Math.min(text.length, contentsIndex + 30000)
    return text.slice(start, end)
  }

  // Extract up to 30k chars starting from TOC heading
  const start = Math.max(0, tocIndex)
  const end = Math.min(text.length, tocIndex + 30000)
  return text.slice(start, end)
}

interface TocAIResult {
  sections: RawTocEntry[]
  failed: boolean
}

/**
 * Use AI to generate structured TOC from extracted text.
 */
async function generateTocWithAI(tocText: string): Promise<TocAIResult> {
  const model = createChatModel()

  const result = await tryCatch(
    generateObject({
      model,
      schema: TocSchema,
      system: TOC_SYSTEM_PROMPT,
      prompt: tocText,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
    }),
  )

  if (!result.success) {
    console.warn("[toc] AI generation failed:", result.error)
    return { sections: [], failed: true }
  }

  return { sections: result.data.object.sections, failed: false }
}

/**
 * Check if a page string is a roman numeral.
 */
function isRomanNumeral(page: string): boolean {
  const normalized = page.trim().toLowerCase()
  return /^[ivxlcdm]+$/i.test(normalized)
}

/**
 * Parse a page string to number. Returns null for roman numerals or invalid values.
 */
function parsePageNumber(page: string): number | null {
  const normalized = page.trim()
  if (isRomanNumeral(normalized)) {
    return null
  }
  const num = parseInt(normalized, 10)
  return isNaN(num) ? null : num
}

interface OffsetResult {
  offset: number
  detected: boolean
}

/**
 * Calculate page offset by scanning PDF footers for a number matching a TOC entry.
 *
 * Scans through the PDF looking for footer page numbers that match TOC entries.
 * This handles PDFs with significant front matter (e.g., 38 pages before "page 1").
 */
function calculatePageOffset(
  sections: RawTocEntry[],
  pdfBuffer: Buffer | Uint8Array,
): OffsetResult {
  // Build set of all valid Arabic page numbers from TOC
  const tocPages = new Set<number>()
  for (const section of sections) {
    const page = parsePageNumber(section.page)
    if (page !== null) tocPages.add(page)
    for (const child of section.children ?? []) {
      const childPage = parsePageNumber(child.page)
      if (childPage !== null) tocPages.add(childPage)
    }
  }

  if (tocPages.size === 0) {
    return { offset: 0, detected: false }
  }

  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
  try {
    const pageCount = doc.countPages()
    const maxSearch = Math.min(150, pageCount)

    // Scan forward looking for a footer number that matches a TOC entry
    for (let physicalPage = 0; physicalPage < maxSearch; physicalPage++) {
      const footerNum = extractFooterPageNumber(doc, physicalPage)
      if (footerNum !== null && tocPages.has(footerNum)) {
        // offset = physicalPage (0-indexed) - footerNum + 1
        // e.g., physical page 39 (0-indexed) with footer "2" → offset = 39 - 2 + 1 = 38
        const offset = physicalPage - footerNum + 1
        if (offset >= 0) {
          return { offset, detected: true }
        }
      }
    }

    return { offset: 0, detected: false }
  } finally {
    doc.destroy()
  }
}

/**
 * Extract page number from footer region of a page.
 * Looks at the bottom 10% of the page for numbers.
 */
function extractFooterPageNumber(
  doc: mupdf.Document,
  pageNum: number,
): number | null {
  const page = doc.loadPage(pageNum)
  const bounds = page.getBounds()
  const pageHeight = bounds[3] - bounds[1]

  // Footer region: bottom 10% of page
  const footerTop = bounds[3] - pageHeight * 0.1

  const stext = page.toStructuredText()
  const footerChars: string[] = []

  stext.walk({
    onChar(c: string, _origin, _font, _size, quad) {
      // Get character Y position (average of quad Y values)
      const charY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
      if (charY >= footerTop) {
        footerChars.push(c)
      }
    },
  })

  const footerText = footerChars.join("").trim()

  // Look for standalone numbers in footer (common page number patterns)
  // Order: explicit patterns first, then position-based (start before end to avoid "Chapter 1")
  const pagePatterns = [
    /^(\d+)$/, // Just a number
    /page\s*(\d+)/i, // "Page X"
    /\b(\d+)\s*of\s*\d+/i, // "X of Y"
    /^\s*(\d+)\b/, // Number at start
    /\b(\d+)\s*$/, // Number at end
  ]

  for (const pattern of pagePatterns) {
    const match = footerText.match(pattern)
    if (match && match[1]) {
      const num = parseInt(match[1], 10)
      if (!isNaN(num) && num > 0 && num < 10000) {
        return num
      }
    }
  }

  return null
}

/**
 * Convert raw TOC entries to final TocSection format with physical page numbers.
 */
function convertToTocSections(
  rawSections: RawTocEntry[],
  offset: number,
): TocSection[] {
  return rawSections
    .map((section) => {
      const displayPage = parsePageNumber(section.page)
      if (displayPage === null) {
        // Skip roman numeral entries for now (could add support later)
        return null
      }

      const physicalPage = displayPage + offset
      const result: TocSection = {
        id: `page-marker-${physicalPage}`,
        title: section.title,
        page: physicalPage,
      }

      if (section.children?.length) {
        result.children = section.children
          .map((child) => {
            const childDisplayPage = parsePageNumber(child.page)
            if (childDisplayPage === null) return null

            const childPhysicalPage = childDisplayPage + offset
            return {
              id: `page-marker-${childPhysicalPage}`,
              title: child.title,
              page: childPhysicalPage,
            }
          })
          .filter((c): c is TocSection => c !== null)
      }

      return result
    })
    .filter((s): s is TocSection => s !== null)
}
