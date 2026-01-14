/** Download endpoint - generates complete HTML with embedded subsetted fonts. */
import { Hono } from "hono"
import * as cheerio from "cheerio"
import { minify } from "html-minifier-terser"
import type { BackendType } from "../types"
import type { Storage } from "../storage/types"
import { getDocumentPath } from "../storage/types"
import { getAuth } from "../middleware/auth"
import { createBackend } from "../backends/factory"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { enhanceHtmlForReader } from "../utils/html-processing"
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
import htmlResultCssRaw from "../../styles/html-result.css" with { type: "text" }
// Import copy-tex script for LaTeX copy support
import copyTexScript from "katex/dist/contrib/copy-tex.min.js" with { type: "text" }

// Remove @fontsource import and fix font-family name
const htmlResultCss = htmlResultCssRaw
  .replace(/@import\s+["']@fontsource[^"']+["'];?\s*/g, "")
  .replace(/Source Sans 3 Variable/g, "Source Sans 3")

// Icons for theme toggle
const SUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
const BOOK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`
const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`

// Load KaTeX CSS rules (without @font-face)
const katexCssRules = getKatexCssRules()

type Variables = {
  storage: Storage
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
  </script>
  <script>${copyTexScript.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`
}

download.get("/jobs/:jobId/download", async (c) => {
  const event = c.get("event")
  const jobId = c.req.param("jobId")
  const title = sanitizeTitle(c.req.query("title") || "")

  event.jobId = jobId
  event.backend = (process.env.BACKEND_MODE || "local") as BackendType

  const backendResult = await tryCatch(async () => createBackend())
  if (!backendResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(backendResult.error),
      code: "BACKEND_INIT_ERROR",
    }
    return c.json({ error: "Failed to initialize backend" }, { status: 500 })
  }

  const jobResult = await tryCatch(backendResult.data.getJobStatus(jobId))
  if (!jobResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(jobResult.error),
      code: "JOB_STATUS_ERROR",
    }
    return c.json({ error: "Failed to get job status" }, { status: 500 })
  }

  let html = jobResult.data.result?.content || jobResult.data.htmlContent
  if (!html) {
    event.error = {
      category: "validation",
      message: "No HTML content available",
      code: "NO_CONTENT",
    }
    return c.json(
      { error: "No HTML content available for this job" },
      { status: 404 },
    )
  }

  html = enhanceHtmlForReader(html)
  const $ = cheerio.load(html)

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
  const fullHtml = generateHtmlDocument(html, title, fontCss, katexCssRules)

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

/**
 * Download by fileId - reads HTML from S3 storage.
 * Works for both signed-in and signed-out users.
 */
download.get("/files/:fileId/download", async (c) => {
  const event = c.get("event")
  const fileId = c.req.param("fileId")
  const title = sanitizeTitle(c.req.query("title") || "")

  event.fileId = fileId

  // Get optional auth to reconstruct document path
  const auth = await getAuth(c)
  const docPath = getDocumentPath(fileId, auth?.userId)
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
  const fullHtml = generateHtmlDocument(html, title, fontCss, katexCssRules)

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
