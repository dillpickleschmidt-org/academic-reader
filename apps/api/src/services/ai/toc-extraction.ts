import * as mupdf from "mupdf"
import { generateText, Output } from "ai"
import { z } from "zod"
import { Effect } from "effect"
import { ModelProvider } from "../model-provider"
import { Storage } from "../storage"

export interface TocSection {
  id: string
  title: string
  page: number
  children?: TocSection[]
}

export interface TocResult {
  sections: TocSection[]
  offset: number
  hasRomanNumerals?: boolean
}

export type TocStatus =
  | "success"
  | "no_toc_text"
  | "ai_failed"
  | "empty_sections"
  | "skipped"
  | "pdf_read_failed"
  | "error"

export interface TocExtractionMeta {
  status: TocStatus
  offsetDetected: boolean
}

export interface TocExtractionResult {
  toc: TocResult | null
  meta: TocExtractionMeta
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
        .array(z.object({ title: z.string(), page: z.string() }))
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

export function extractTableOfContents(
  convertedText: string,
  pdfBuffer: Buffer | Uint8Array,
) {
  return Effect.gen(function* () {
    const models = yield* ModelProvider

    const outlineSections = extractPdfOutline(pdfBuffer)
    if (outlineSections.length > 0) {
      return {
        toc: { sections: outlineSections, offset: 0, hasRomanNumerals: false },
        meta: { status: "success" as const, offsetDetected: true },
      } satisfies TocExtractionResult
    }

    const tocText = findTocText(convertedText)
    if (!tocText) {
      return {
        toc: null,
        meta: { status: "no_toc_text" as const, offsetDetected: false },
      } satisfies TocExtractionResult
    }

    const { sections: rawSections, failed: aiFailed } =
      yield* generateTocWithAI(tocText, models)
    if (aiFailed) {
      return {
        toc: null,
        meta: { status: "ai_failed" as const, offsetDetected: false },
      } satisfies TocExtractionResult
    }
    if (!rawSections.length) {
      return {
        toc: null,
        meta: { status: "empty_sections" as const, offsetDetected: false },
      } satisfies TocExtractionResult
    }

    const hasRomanNumerals = rawSections.some(
      (s) =>
        isRomanNumeral(s.page) ||
        s.children?.some((c) => isRomanNumeral(c.page)),
    )

    const { offset, detected: offsetDetected } = calculatePageOffset(
      rawSections,
      pdfBuffer,
    )
    const sections = convertToTocSections(rawSections, offset)

    return {
      toc: { sections, offset, hasRomanNumerals },
      meta: { status: "success" as const, offsetDetected },
    } satisfies TocExtractionResult
  })
}

interface PdfOutlineItem {
  title: string
  page?: number
  down?: PdfOutlineItem[]
}

function extractPdfOutline(pdfBuffer: Buffer | Uint8Array): TocSection[] {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
  try {
    const outline = doc.loadOutline() as PdfOutlineItem[] | null
    if (!outline || outline.length === 0) return []

    const sections: TocSection[] = []
    for (const item of outline) {
      if (item.page === undefined) continue
      const physicalPage = item.page + 1

      const section: TocSection = {
        id: `page-marker-${physicalPage}`,
        title: item.title,
        page: physicalPage,
      }

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

function findTocText(text: string): string | null {
  const lowerText = text.toLowerCase()
  const tocIndex = lowerText.indexOf("table of contents")

  if (tocIndex === -1) {
    const contentsIndex = lowerText.indexOf("contents\n")
    if (contentsIndex === -1) return null
    const start = Math.max(0, contentsIndex)
    return text.slice(start, Math.min(text.length, start + 30000))
  }

  const start = Math.max(0, tocIndex)
  return text.slice(start, Math.min(text.length, start + 30000))
}

function generateTocWithAI(
  tocText: string,
  models: { processingModel(): any },
): Effect.Effect<{ sections: RawTocEntry[]; failed: boolean }, never, never> {
  return Effect.tryPromise({
    try: async () => {
      const model = models.processingModel()
      const result = await generateText({
        model,
        output: Output.object({ schema: TocSchema }),
        system: TOC_SYSTEM_PROMPT,
        prompt: tocText,
      })
      if (!result.output) return { sections: [] as RawTocEntry[], failed: true }
      return {
        sections: result.output.sections as RawTocEntry[],
        failed: false,
      }
    },
    catch: (e) => e,
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({ sections: [] as RawTocEntry[], failed: true }),
    ),
  )
}

function isRomanNumeral(page: string): boolean {
  return /^[ivxlcdm]+$/i.test(page.trim().toLowerCase())
}

function parsePageNumber(page: string): number | null {
  const normalized = page.trim()
  if (isRomanNumeral(normalized)) return null
  const num = parseInt(normalized, 10)
  return isNaN(num) ? null : num
}

function calculatePageOffset(
  sections: RawTocEntry[],
  pdfBuffer: Buffer | Uint8Array,
): { offset: number; detected: boolean } {
  const tocPages = new Set<number>()
  for (const section of sections) {
    const page = parsePageNumber(section.page)
    if (page !== null) tocPages.add(page)
    for (const child of section.children ?? []) {
      const childPage = parsePageNumber(child.page)
      if (childPage !== null) tocPages.add(childPage)
    }
  }

  if (tocPages.size === 0) return { offset: 0, detected: false }

  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf")
  try {
    const pageCount = doc.countPages()
    const maxSearch = Math.min(150, pageCount)

    for (let physicalPage = 0; physicalPage < maxSearch; physicalPage++) {
      const footerNum = extractFooterPageNumber(doc, physicalPage)
      if (footerNum !== null && tocPages.has(footerNum)) {
        const offset = physicalPage - footerNum + 1
        if (offset >= 0) return { offset, detected: true }
      }
    }
    return { offset: 0, detected: false }
  } finally {
    doc.destroy()
  }
}

function extractFooterPageNumber(
  doc: mupdf.Document,
  pageNum: number,
): number | null {
  const page = doc.loadPage(pageNum)
  const bounds = page.getBounds()
  const pageHeight = bounds[3] - bounds[1]
  const footerTop = bounds[3] - pageHeight * 0.1

  const stext = page.toStructuredText()
  const footerChars: string[] = []

  stext.walk({
    onChar(c: string, _origin: any, _font: any, _size: any, quad: any) {
      const charY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
      if (charY >= footerTop) footerChars.push(c)
    },
  })

  const footerText = footerChars.join("").trim()
  const pagePatterns = [
    /^(\d+)$/,
    /page\s*(\d+)/i,
    /\b(\d+)\s*of\s*\d+/i,
    /^\s*(\d+)\b/,
    /\b(\d+)\s*$/,
  ]

  for (const pattern of pagePatterns) {
    const match = footerText.match(pattern)
    if (match && match[1]) {
      const num = parseInt(match[1], 10)
      if (!isNaN(num) && num > 0 && num < 10000) return num
    }
  }

  return null
}

function convertToTocSections(
  rawSections: RawTocEntry[],
  offset: number,
): TocSection[] {
  return rawSections
    .map((section) => {
      const displayPage = parsePageNumber(section.page)
      if (displayPage === null) return null

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
