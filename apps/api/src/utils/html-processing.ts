import * as cheerio from "cheerio"
import type { CheerioAPI } from "cheerio"
import katex from "katex"
import { escapeHtml } from "./sanitize"

interface HtmlProcessingStats {
  katexFailureCount: number
}

type HtmlTransform = ($: CheerioAPI, stats: HtmlProcessingStats) => void

export const HTML_TRANSFORMS: HtmlTransform[] = [
  ($) => $(".img-description").remove(),
  demoteExtraH1s,
  wrapCitations,
  processParagraphs,
  convertMathToHtml,
  wrapTablesInScrollContainers,
]

export function processHtml(html: string, transforms: HtmlTransform[]) {
  const $ = cheerio.load(html)
  const stats: HtmlProcessingStats = { katexFailureCount: 0 }
  for (const transform of transforms) {
    transform($, stats)
  }
  return { html: $("body").html() ?? "", stats }
}

function demoteExtraH1s($: CheerioAPI): void {
  $("h1").each(function (index) {
    if (index === 0) return
    const $h1 = $(this)
    const $h2 = $("<h2>")
    $h2.html($h1.html() ?? "")
    const attrs = $h1.attr()
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        $h2.attr(key, value)
      }
    }
    $h1.replaceWith($h2)
  })
}

function wrapTablesInScrollContainers($: CheerioAPI): void {
  $("table").each(function () {
    $(this).wrap(
      '<div class="table-container"><div class="table-scroll"></div></div>',
    )
  })
}

const CITATION_PATTERN = /\[(?:[A-Z][^\]]{0,100}\d{4}|[\d,;\s\-–]{1,50})\]/g

function wrapCitations($: CheerioAPI): void {
  $("body")
    .find("*")
    .contents()
    .filter(function () {
      return this.type === "text" && !$(this).closest("a").length
    })
    .each(function () {
      const text = $(this).text()
      if (!CITATION_PATTERN.test(text)) return

      CITATION_PATTERN.lastIndex = 0

      const parts: string[] = []
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = CITATION_PATTERN.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(escapeHtml(text.slice(lastIndex, match.index)))
        }
        parts.push(`<span class="citation">${escapeHtml(match[0])}</span>`)
        lastIndex = match.index + match[0].length
      }

      if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)))
      }

      if (parts.length > 0) {
        $(this).replaceWith(parts.join(""))
      }
    })
}

function processParagraphs($: CheerioAPI): void {
  const h1 = $("h1").first()
  const authorSectionEnd = h1.length > 0 ? h1.nextAll("h1, h2").first() : null

  $("p").each(function () {
    const $p = $(this)
    const text = $p.text().replace(/\s+/g, " ").trim()

    if (h1.length > 0 && text.length < 200) {
      const isAfterH1 = $p.prevAll().filter("h1").first().is(h1)
      const isBeforeH2 =
        !authorSectionEnd?.length ||
        $p.nextAll().filter("h1, h2").first().is(authorSectionEnd)
      if (isAfterH1 && isBeforeH2) {
        $p.addClass("author-meta")
      }
    }

    if (/^Fig\.\s*\d/.test(text)) {
      $p.addClass("figure-caption")
    } else if (text.length > 0 && /^[a-z]/.test(text)) {
      $p.addClass("continuation")
    }
  })
}

function convertMathToHtml($: CheerioAPI, stats: HtmlProcessingStats): void {
  $("math").each(function () {
    const latex = $(this).text().trim()
    if (!latex) return

    const isDisplay = $(this).attr("display") === "block"
    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: isDisplay,
        output: "htmlAndMathml",
      })
      $(this).replaceWith(html)
    } catch {
      stats.katexFailureCount++
    }
  })
}

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

interface PageMarkerStats {
  expected: number
  injected: number
}

interface PageMarkerResult {
  html: string
  stats: PageMarkerStats
}

export function injectPageMarkers(
  html: string,
  offset: number = 0,
): PageMarkerResult {
  const $ = cheerio.load(html)

  const pageFirstBlockId = new Map<number, string>()
  $("[data-block-id]").each((_, el) => {
    const blockId = $(el).attr("data-block-id")
    const match = blockId?.match(/^\/page\/(\d+)\//)
    if (match && blockId) {
      const page = parseInt(match[1], 10)
      if (!pageFirstBlockId.has(page)) {
        pageFirstBlockId.set(page, blockId)
      }
    }
  })

  if (pageFirstBlockId.size === 0) {
    return { html: $("body").html() ?? "", stats: { expected: 0, injected: 0 } }
  }

  const minPage = Math.min(...pageFirstBlockId.keys())
  for (const [physicalPage, blockId] of pageFirstBlockId) {
    const displayPage = physicalPage - offset + 1
    const divider = physicalPage > minPage ? `<hr class="page-divider" />` : ""
    const marker = `${divider}<span class="page-marker" id="page-marker-${physicalPage}">${displayPage}</span>`
    $(`[data-block-id="${blockId}"]`).before(marker)
  }

  return {
    html: $("body").html() ?? "",
    stats: { expected: pageFirstBlockId.size, injected: pageFirstBlockId.size },
  }
}
