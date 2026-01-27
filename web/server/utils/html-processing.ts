/**
 * HTML post-processing for reader enhancements.
 * Uses single-parse pipeline for efficiency.
 */
import * as cheerio from "cheerio"
import type { CheerioAPI } from "cheerio"
import katex from "katex"
import { escapeHtml } from "./sanitize"

export type HtmlTransform = ($: CheerioAPI) => void

/**
 * Process HTML with a single parse, applying multiple transforms.
 */
export function processHtml(html: string, transforms: HtmlTransform[]): string {
  const $ = cheerio.load(html)
  for (const transform of transforms) {
    transform($)
  }
  return $("body").html() ?? ""
}

/** Remove redundant img-description elements */
export function removeImgDescriptions($: CheerioAPI): void {
  $(".img-description").remove()
}

/**
 * Apply reader enhancements to HTML: citations, math, figure captions, etc.
 * Convenience wrapper for backward compatibility.
 */
export function enhanceHtmlForReader(html: string): string {
  return processHtml(html, [
    removeImgDescriptions,
    wrapCitations,
    // addInferredCrossReferenceLinks, // Disabled: infers new links from text patterns (vs PDF extraction which preserves original links)
    processParagraphs,
    convertMathToHtml,
    wrapTablesInScrollContainers,
  ])
}

/** Wrap tables in scroll containers for horizontal overflow with shadow indicators */
export function wrapTablesInScrollContainers($: CheerioAPI): void {
  $("table").each(function () {
    // Two wrappers: outer holds shadows (position: relative), inner handles scroll (overflow-x: auto)
    $(this).wrap('<div class="table-container"><div class="table-scroll"></div></div>')
  })
}

/**
 * Citation patterns:
 * - Author-year: [Smith 2020], [Smith et al. 2020], [Smith and Jones 2020; Brown 2021]
 * - Numeric: [1], [1, 2], [1-5], [1, 3-5, 8]
 */
const CITATION_PATTERN = /\[(?:[A-Z][^\]]{0,100}\d{4}|[\d,;\s\-–]{1,50})\]/g

/**
 * Cross-reference patterns for sections and figures
 */
const SECTION_REF_PATTERN = /\bSec(?:tion)?\.?\s*([\d.]+)/g
const FIGURE_REF_PATTERN = /\bFig(?:ure)?\.?\s*([\d.]+)/g

/** Wrap academic citations in spans for styling */
export function wrapCitations($: CheerioAPI): void {
  // Process all text nodes (skip text inside existing anchors to avoid conflicts)
  $("body")
    .find("*")
    .contents()
    .filter(function () {
      return this.type === "text" && !$(this).closest("a").length
    })
    .each(function () {
      const text = $(this).text()
      if (!CITATION_PATTERN.test(text)) return

      // Reset regex state
      CITATION_PATTERN.lastIndex = 0

      const parts: string[] = []
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = CITATION_PATTERN.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(escapeHtml(text.slice(lastIndex, match.index)))
        }
        // Add wrapped citation
        parts.push(`<span class="citation">${escapeHtml(match[0])}</span>`)
        lastIndex = match.index + match[0].length
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)))
      }

      if (parts.length > 0) {
        $(this).replaceWith(parts.join(""))
      }
    })
}

/**
 * Infer cross-reference links from text patterns (Sec. 5.1, Fig. 4).
 * Unlike PDF link extraction which preserves links that existed in the original PDF,
 * this function creates NEW links by matching text patterns to headings/figures.
 */
export function addInferredCrossReferenceLinks($: CheerioAPI): void {
  // Build section index: "5.1" -> block ID
  const sectionIndex = new Map<string, string>()
  $("h1, h2, h3, h4, h5, h6").each(function () {
    const id = $(this).attr("data-block-id")
    const text = $(this).text().trim()
    // Extract section number from heading text (e.g., "5.1" from "5.1 Branch Modules")
    const match = text.match(/^([\d.]+)\s/)
    if (match && id) {
      sectionIndex.set(match[1], id)
    }
  })

  // Build figure index: "4" -> generated ID, also add ID to figure captions
  const figureIndex = new Map<string, string>()
  $(".figure-caption").each(function () {
    const text = $(this).text()
    const match = text.match(/^Fig\.?\s*([\d.]+)/i)
    if (match) {
      const id = `fig-${match[1].replace(/\./g, "-")}`
      $(this).attr("id", id)
      figureIndex.set(match[1], id)
    }
  })

  // Process text nodes and replace references with links (skip text inside existing anchors)
  $("body")
    .find("*")
    .contents()
    .filter(function () {
      return this.type === "text" && !$(this).closest("a").length
    })
    .each(function () {
      const text = $(this).text()

      // Quick check if any patterns exist
      SECTION_REF_PATTERN.lastIndex = 0
      FIGURE_REF_PATTERN.lastIndex = 0
      if (!SECTION_REF_PATTERN.test(text) && !FIGURE_REF_PATTERN.test(text)) {
        return
      }

      // Reset patterns and process
      SECTION_REF_PATTERN.lastIndex = 0
      FIGURE_REF_PATTERN.lastIndex = 0

      let result = text
      let modified = false

      // Replace section refs
      result = result.replace(SECTION_REF_PATTERN, (match, num) => {
        const id = sectionIndex.get(num)
        if (id) {
          modified = true
          return `<a href="#${id}" class="ref-link">${escapeHtml(match)}</a>`
        }
        return match
      })

      // Replace figure refs
      FIGURE_REF_PATTERN.lastIndex = 0
      result = result.replace(FIGURE_REF_PATTERN, (match, num) => {
        const id = figureIndex.get(num)
        if (id) {
          modified = true
          return `<a href="#${id}" class="ref-link">${escapeHtml(match)}</a>`
        }
        return match
      })

      if (modified) {
        $(this).replaceWith(result)
      }
    })
}

/** Single-pass paragraph processing: author meta, figure captions, continuations */
export function processParagraphs($: CheerioAPI): void {
  const h1 = $("h1").first()
  const authorSectionEnd = h1.length > 0 ? h1.nextAll("h1, h2").first() : null

  $("p").each(function () {
    const $p = $(this)
    const text = $p.text().replace(/\s+/g, " ").trim()

    // Author meta: short paragraphs between h1 and first h2
    if (h1.length > 0 && text.length < 200) {
      const isAfterH1 = $p.prevAll().filter("h1").first().is(h1)
      const isBeforeH2 =
        !authorSectionEnd?.length ||
        $p.nextAll().filter("h1, h2").first().is(authorSectionEnd)
      if (isAfterH1 && isBeforeH2) {
        $p.addClass("author-meta")
      }
    }

    // Figure caption: starts with "Fig. #"
    if (/^Fig\.\s*\d/.test(text)) {
      $p.addClass("figure-caption")
    }
    // Continuation: starts with lowercase
    else if (text.length > 0 && /^[a-z]/.test(text)) {
      $p.addClass("continuation")
    }
  })
}

/**
 * Convert <math> tags containing LaTeX to HTML via KaTeX.
 * KaTeX outputs HTML+CSS that works on all browsers (no MathML dependency).
 */
export function convertMathToHtml($: CheerioAPI): void {
  $("math").each(function () {
    const latex = $(this).text().trim()
    if (!latex) return

    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
        output: "htmlAndMathml",
      })
      $(this).replaceWith(html)
    } catch (e) {
      console.warn(`[html] KaTeX failed for: ${latex.slice(0, 50)}...`, e)
    }
  })
}

/**
 * Rewrite image src attributes to use storage URLs.
 * Replaces src="filename.png" with src="https://storage.../filename.png".
 */
export function rewriteImageSources(
  html: string,
  imageUrls: Record<string, string>,
): string {
  const $ = cheerio.load(html)

  $("img").each(function () {
    const src = $(this).attr("src")
    if (src && imageUrls[src]) {
      $(this).attr("src", imageUrls[src])
    }
  })

  return $("body").html() ?? ""
}

interface ChunkPageInfo {
  id: string
  page: number
}

/**
 * Inject page markers into HTML before each page's first block.
 * Markers serve as scroll targets for TOC navigation and display page numbers.
 *
 * @param html - The HTML content to process
 * @param chunks - Array of chunks with block IDs and page numbers
 * @param offset - Page offset (physical - display), defaults to 0
 */
export function injectPageMarkers(
  html: string,
  chunks: ChunkPageInfo[],
  offset: number = 0,
): string {
  const $ = cheerio.load(html)

  // Build page -> first block ID map
  const pageFirstBlock = new Map<number, string>()
  for (const chunk of chunks) {
    if (!pageFirstBlock.has(chunk.page)) {
      pageFirstBlock.set(chunk.page, chunk.id)
    }
  }

  // Inject marker before each page's first block
  for (const [physicalPage, blockId] of pageFirstBlock) {
    const displayPage = physicalPage - offset
    const marker = `<span class="page-marker" id="page-marker-${physicalPage}">${displayPage}</span>`
    const block = $(`[data-block-id="${blockId}"]`)
    if (block.length) {
      block.before(marker)
    }
  }

  return $("body").html() ?? ""
}

