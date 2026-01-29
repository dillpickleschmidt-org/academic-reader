/** Download endpoint - generates complete HTML with embedded subsetted fonts. */
import { Hono } from "hono"
import * as cheerio from "cheerio"
import type { CheerioAPI } from "cheerio"
import { minify } from "html-minifier-terser"
import type { Storage } from "../storage/types"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { enhanceHtmlForReader } from "../utils/html-processing"
import { getImageMimeType } from "../utils/mime-types"
import {
  escapeHtml,
  sanitizeTitle,
  contentDisposition,
} from "../utils/sanitize"
import {
  extractKatexFontUsage,
  embedSourceSans,
  subsetKatexFonts,
  getKatexCssRules,
} from "../utils/font-subsetting"

// Import CSS files as text
import baseResultCss from "../styles/base-result.css" with { type: "text" }
import htmlResultCssRaw from "../../client/styles/html-result.css" with { type: "text" }
// Import copy-tex script for LaTeX copy support
import copyTexScript from "katex/dist/contrib/copy-tex.min.js" with { type: "text" }

// Remove @fontsource import, fix font-family name, and add standalone font rules
const htmlResultCss =
  htmlResultCssRaw
    .replace(/@import\s+["']@fontsource[^"']+["'];?\s*/g, "")
    .replace(/Source Sans 3 Variable/g, "Source Sans 3") +
  `
/* Standalone font rules - not using theme variables */
.reader-content { font-family: Georgia, "Times New Roman", serif; }
.reader-content h2, .reader-content h3, .reader-content h4, .reader-content h5, .reader-content h6 { font-family: "Source Sans 3", "Source Sans Pro", sans-serif; }
.reader-content th { font-family: "Source Sans 3", sans-serif; }
.reader-content code { font-family: "SF Mono", "Fira Code", Consolas, monospace; }
`

// Icons for theme toggle
const SUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
const BOOK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`
const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`

// Load KaTeX CSS rules (without @font-face)
const katexCssRules = getKatexCssRules()

type Variables = {
  storage: Storage
  userId: string
}

export const download = new Hono<{ Variables: Variables }>()

/**
 * Generate complete HTML document with embedded fonts.
 */
function generateHtmlDocument(
  renderedContent: string,
  title: string,
  fontCss: string,
  katexCss: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${fontCss}
${katexCss}
${baseResultCss}
${htmlResultCss}
  </style>
</head>
<body>
  <input type="radio" id="theme-light" name="theme" class="theme-radios" checked>
  <input type="radio" id="theme-comfort" name="theme" class="theme-radios">
  <input type="radio" id="theme-dark" name="theme" class="theme-radios">
  <div class="reader-output">
    <div class="reader-theme-toggle">
      <label for="theme-light" title="Light">${SUN_ICON}</label>
      <label for="theme-comfort" title="Comfort">${BOOK_ICON}</label>
      <label for="theme-dark" title="Dark">${MOON_ICON}</label>
    </div>
    <div class="reader-content">
${renderedContent}
    </div>
  </div>

  <script>
    // Optional enhancement: persist theme to localStorage
    (function() {
      var radios = document.querySelectorAll('.theme-radios');
      var saved = localStorage.getItem('reader-theme');
      if (saved) {
        var radio = document.getElementById('theme-' + saved);
        if (radio) radio.checked = true;
      }
      radios.forEach(function(radio) {
        radio.addEventListener('change', function() {
          localStorage.setItem('reader-theme', this.id.replace('theme-', ''));
        });
      });
    })();
    // Compact wide tables and update shadow classes based on scroll position
    document.querySelectorAll('.table-scroll').forEach(function(el) {
      // Compact wide tables (reduce padding + zoom)
      if (el.scrollWidth > el.clientWidth) {
        var t = el.querySelector('table');
        if (t) t.classList.add('table-compact');
      }
      function update() {
        var c = el.parentElement, o = el.scrollWidth > el.clientWidth;
        if (c) {
          c.classList.toggle('has-overflow-left', o && el.scrollLeft > 0);
          c.classList.toggle('has-overflow-right', o && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
        }
      }
      update();
      el.addEventListener('scroll', update, { passive: true });
    });
  </script>
  <script>${copyTexScript.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`
}

/**
 * Embed images from R2 as base64 data URIs for self-contained HTML downloads.
 * Looks for img tags with src URLs containing the docPath/images/ pattern.
 */
async function embedImagesFromStorage(
  $: CheerioAPI,
  storage: Storage,
  docPath: string,
): Promise<void> {
  const images = $("img").toArray()
  const imagesPath = `${docPath}/images/`

  await Promise.all(
    images.map(async (el) => {
      const src = $(el).attr("src")
      if (!src) return

      // Check if this is an R2 URL pointing to our images folder
      if (!src.includes(imagesPath)) return

      // Extract filename from URL pathname (strips query strings)
      const filename = new URL(src).pathname.split("/").pop()
      if (!filename) return

      try {
        const buffer = await storage.readFile(`${docPath}/images/${filename}`)
        const base64 = buffer.toString("base64")
        $(el).attr("src", `data:${getImageMimeType(filename)};base64,${base64}`)
      } catch {
        console.warn(`[download] Failed to embed image: ${filename}`)
      }
    }),
  )
}

/**
 * Download by fileId - reads HTML from S3 storage.
 * Requires authentication.
 */
download.get("/files/:fileId/download", requireAuth, async (c) => {
  const event = c.get("event")
  const fileId = c.req.param("fileId")
  const title = sanitizeTitle(c.req.query("title") || "")

  event.fileId = fileId

  const userId = c.get("userId")
  const docPath = `documents/${userId}/${fileId}`
  const storage = c.get("storage")

  // Read HTML from S3
  const htmlResult = await tryCatch(
    storage.readFileAsString(`${docPath}/content.html`),
  )
  if (!htmlResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(htmlResult.error),
      code: "FILE_READ_ERROR",
    }
    return c.json({ error: "Document not found" }, { status: 404 })
  }

  const html = enhanceHtmlForReader(htmlResult.data)
  const $ = cheerio.load(html)

  // Embed images from R2 as base64 for self-contained download
  await embedImagesFromStorage($, storage, docPath)

  const katexFontUsage = extractKatexFontUsage($)

  const fontsResult = await tryCatch(
    Promise.all([embedSourceSans(), subsetKatexFonts(katexFontUsage)]),
  )
  if (!fontsResult.success) {
    event.error = {
      category: "internal",
      message: getErrorMessage(fontsResult.error),
      code: "FONT_EMBED_ERROR",
    }
    return c.json({ error: "Failed to embed fonts" }, { status: 500 })
  }

  const [sourceSansCss, katexFontsCss] = fontsResult.data
  const fontCss = `${sourceSansCss}\n${katexFontsCss}`
  // Get HTML from cheerio after image embedding
  const finalHtml = $("body").html() || html
  const fullHtml = generateHtmlDocument(finalHtml, title, fontCss, katexCssRules)

  const minifyResult = await tryCatch(
    minify(fullHtml, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
    }),
  )
  if (!minifyResult.success) {
    event.error = {
      category: "internal",
      message: getErrorMessage(minifyResult.error),
      code: "MINIFY_ERROR",
    }
    return c.json({ error: "Failed to generate download" }, { status: 500 })
  }

  return new Response(minifyResult.data, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": contentDisposition(`${title}.html`),
    },
  })
})
