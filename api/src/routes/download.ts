/** Download endpoint - generates complete HTML with embedded subsetted fonts. */
import { Hono } from "hono"
import * as cheerio from "cheerio"
import { minify } from "html-minifier-terser"
import type { Env } from "../types"
import { createBackend } from "../backends/factory"
import { enhanceHtmlForReader } from "../utils/html-processing"
import {
  extractKatexFontUsage,
  embedSourceSans,
  subsetKatexFonts,
  getKatexCssRules,
} from "../utils/font-subsetting"

// Import CSS files as text
import baseResultCss from "../styles/base-result.css" with { type: "text" }
import htmlResultCssRaw from "../styles/html-result.css" with { type: "text" }
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

export const download = new Hono<{ Bindings: Env }>()

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
  <!-- Theme radio inputs - must be siblings before .reader-output for CSS selectors -->
  <input type="radio" name="theme" id="theme-light" class="theme-radios" checked>
  <input type="radio" name="theme" id="theme-comfort" class="theme-radios">
  <input type="radio" name="theme" id="theme-dark" class="theme-radios">
  <script>
    // Eagerly apply saved theme before render
    (function() {
      var theme = localStorage.getItem('reader-theme');
      if (theme && theme !== 'light') {
        document.getElementById('theme-light').checked = false;
        document.getElementById('theme-' + theme).checked = true;
      }
    })();
  </script>

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
    // Persist theme changes to localStorage
    document.querySelectorAll('input[name="theme"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        localStorage.setItem('reader-theme', this.id.replace('theme-', ''));
      });
    });
  </script>
  <script>${copyTexScript}</script>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

download.get("/api/jobs/:jobId/download", async (c) => {
  const jobId = c.req.param("jobId")
  const title = c.req.query("title") || "Document"

  try {
    const backend = createBackend(c.env)
    const job = await backend.getJobStatus(jobId)

    let html = job.result?.content || job.htmlContent
    if (!html) {
      return c.json(
        { error: "No HTML content available for this job" },
        { status: 404 },
      )
    }

    html = enhanceHtmlForReader(html)
    const $ = cheerio.load(html)

    const katexFontUsage = extractKatexFontUsage($)

    const [sourceSansCss, katexFontsCss] = await Promise.all([
      embedSourceSans(),
      subsetKatexFonts(katexFontUsage),
    ])

    const fontCss = `${sourceSansCss}\n${katexFontsCss}`
    const fullHtml = generateHtmlDocument(html, title, fontCss, katexCssRules)

    // Minify HTML and embedded CSS/JS
    const minifiedHtml = await minify(fullHtml, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
    })

    return new Response(minifiedHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.html"; filename*=UTF-8''${encodeURIComponent(title)}.html`,
      },
    })
  } catch (error) {
    console.error("Download error:", error)
    return c.json({ error: "Failed to generate download" }, { status: 500 })
  }
})
