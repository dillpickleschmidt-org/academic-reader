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

/**
 * Main entry point - extracts structured TOC from converted text with page offset detection.
 */
export async function extractTableOfContents(
  convertedText: string,
  pdfBuffer: Buffer | Uint8Array,
): Promise<TocResult | null> {
  // Search for "table of contents" and extract surrounding text
  const tocText = findTocText(convertedText)
  if (!tocText) {
    return null
  }

  // Generate structured TOC using AI
  const rawSections = await generateTocWithAI(tocText)
  if (!rawSections.length) {
    return null
  }

  // Detect if there are roman numerals (front matter)
  const hasRomanNumerals = rawSections.some(
    (s) => isRomanNumeral(s.page) || s.children?.some((c) => isRomanNumeral(c.page)),
  )

  // Calculate page offset from first Arabic numeral entry
  const offset = calculatePageOffset(rawSections, pdfBuffer)

  // Convert raw sections to final format with physical page numbers
  const sections = convertToTocSections(rawSections, offset)

  return {
    sections,
    offset,
    hasRomanNumerals,
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

/**
 * Use AI to generate structured TOC from extracted text.
 */
async function generateTocWithAI(tocText: string): Promise<RawTocEntry[]> {
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
    return []
  }

  return result.data.object.sections
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

/**
 * Calculate page offset by comparing TOC page number with PDF footer.
 *
 * 1. Find first entry with Arabic numeral
 * 2. Go to that physical page in the PDF
 * 3. Extract footer text (bottom 10% of page)
 * 4. Parse page number from footer
 * 5. Calculate: offset = physicalPage - footerPageNumber
 */
function calculatePageOffset(
  sections: RawTocEntry[],
  pdfBuffer: Buffer | Uint8Array,
): number {
  // Find first Arabic numeral page in TOC
  let firstArabicPage: number | null = null
  for (const section of sections) {
    const page = parsePageNumber(section.page)
    if (page !== null) {
      firstArabicPage = page
      break
    }
    // Check children
    if (section.children) {
      for (const child of section.children) {
        const childPage = parsePageNumber(child.page)
        if (childPage !== null) {
          firstArabicPage = childPage
          break
        }
      }
      if (firstArabicPage !== null) break
    }
  }

  if (firstArabicPage === null) {
    return 0
  }

  // Open PDF and extract footer from the physical page
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
  try {
    const pageCount = doc.countPages()

    // Try the physical page and a few pages around it
    const pagesToTry = [
      firstArabicPage - 1, // 0-indexed
      firstArabicPage,
      firstArabicPage + 1,
      firstArabicPage + 2,
    ].filter((p) => p >= 0 && p < pageCount)

    for (const physicalPage of pagesToTry) {
      const footerPageNum = extractFooterPageNumber(doc, physicalPage)
      if (footerPageNum !== null) {
        // Calculate offset: if TOC says page 15 but footer shows 5, offset = 10
        // So physicalPage 15 = displayPage 5, offset = 15 - 5 = 10
        const offset = physicalPage - footerPageNum + 1 // +1 because physicalPage is 0-indexed
        if (offset >= 0) {
          return offset
        }
      }
    }

    return 0
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
  const pagePatterns = [
    /^(\d+)$/, // Just a number
    /\b(\d+)\s*$/, // Number at end
    /^\s*(\d+)\b/, // Number at start
    /page\s*(\d+)/i, // "Page X"
    /\b(\d+)\s*of\s*\d+/i, // "X of Y"
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
