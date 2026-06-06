import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect } from "effect"
import * as cheerio from "cheerio"
import type { CheerioAPI } from "cheerio"
import { minify } from "html-minifier-terser"
import { requireAuth } from "../middleware/auth"
import { enrichEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
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
import { processHtml, HTML_TRANSFORMS } from "../utils/html-processing"

import baseResultCss from "../styles/base-result.css" with { type: "text" }
import copyTexScript from "katex/dist/contrib/copy-tex.min.js" with { type: "text" }

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

function getImageMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "png"
  return IMAGE_MIME_TYPES[ext] ?? "image/png"
}

function getHtmlResultCss(tabIndent: boolean): string {
  return `
.reader-content { font-family: Georgia, "Times New Roman", serif; }
.reader-content h2, .reader-content h3, .reader-content h4, .reader-content h5, .reader-content h6 { font-family: "Source Sans 3", "Source Sans Pro", sans-serif; }
.reader-content th { font-family: "Source Sans 3", sans-serif; }
.reader-content code { font-family: "SF Mono", "Fira Code", Consolas, monospace; }
${tabIndent ? `.reader-content p { text-indent: 1.5em; }
.reader-content :is(h1, h2, h3, h4, h5, h6, img, figure, blockquote, ul, ol, table, pre) + p { text-indent: 0; }` : ""}
`
}

const SUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
const BOOK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`
const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`

const katexCssRules = getKatexCssRules()

export const downloadRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/:fileId/download",
    Effect.gen(function* () {
      const { userId } = yield* requireAuth
      const storage = yield* Storage
      const params = yield* HttpRouter.params
      const request = yield* HttpServerRequest.HttpServerRequest
      const fileId = params.fileId

      const url = new URL(request.url, "http://localhost")
      const title = sanitizeTitle(url.searchParams.get("title") || "")
      const tabIndent = url.searchParams.get("tabIndent") !== "off"

      yield* enrichEvent({ fileId } as Record<string, unknown>)

      const docPath = `documents/${userId}/${fileId}`

      const htmlResult = yield* storage
        .readFileAsString(`${docPath}/content.html`)
        .pipe(Effect.either)
      if (htmlResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Document not found" },
          { status: 404 },
        )
      }

      const html = processHtml(htmlResult.right, HTML_TRANSFORMS)
      const $ = cheerio.load(html)

      yield* embedImagesFromStorage($, docPath).pipe(Effect.ignore)

      const katexFontUsage = extractKatexFontUsage($)

      const fontsResult = yield* Effect.tryPromise({
        try: () =>
          Promise.all([embedSourceSans(), subsetKatexFonts(katexFontUsage)]),
        catch: (e) => e,
      }).pipe(Effect.either)

      if (fontsResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Failed to embed fonts" },
          { status: 500 },
        )
      }

      const [sourceSansCss, katexFontsCss] = fontsResult.right
      const fontCss = `${sourceSansCss}\n${katexFontsCss}`
      const finalHtml = $("body").html() || html
      const htmlResultCss = getHtmlResultCss(tabIndent)
      const fullHtml = generateHtmlDocument(
        finalHtml,
        title,
        fontCss,
        katexCssRules,
        htmlResultCss,
      )

      const minifyResult = yield* Effect.tryPromise({
        try: () =>
          minify(fullHtml, {
            collapseWhitespace: true,
            removeComments: true,
            minifyCSS: true,
            minifyJS: true,
          }),
        catch: (e) => e,
      }).pipe(Effect.either)

      if (minifyResult._tag === "Left") {
        return HttpServerResponse.unsafeJson(
          { error: "Failed to generate download" },
          { status: 500 },
        )
      }

      const body = new TextEncoder().encode(minifyResult.right)
      return HttpServerResponse.uint8Array(body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": contentDisposition(`${title}.html`),
        },
      })
    }),
  ),
)

function generateHtmlDocument(
  renderedContent: string,
  title: string,
  fontCss: string,
  katexCss: string,
  htmlResultCss: string,
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
    document.querySelectorAll('.table-scroll').forEach(function(el) {
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

function embedImagesFromStorage($: CheerioAPI, docPath: string) {
  return Effect.gen(function* () {
    const storage = yield* Storage
    const images = $("img").toArray()

    yield* Effect.all(
      images
        .map((el) =>
          Effect.gen(function* () {
            const src = $(el).attr("src")
            if (!src) return
            const filename = imageFilename(src)
            if (!filename) return
            const buffer = yield* storage.readFile(
              `${docPath}/images/${filename}`,
            )
            const base64 = buffer.toString("base64")
            $(el).attr(
              "src",
              `data:${getImageMimeType(filename)};base64,${base64}`,
            )
          }).pipe(Effect.catchAll(() => Effect.void)),
        ),
      { concurrency: "unbounded" },
    )
  })
}

function imageFilename(src: string): string | null {
  try {
    const pathname = new URL(src, "http://localhost").pathname
    if (!pathname.includes("/images/")) return null
    const filename = pathname.split("/").pop()
    return filename ? decodeURIComponent(filename) : null
  } catch {
    return null
  }
}
