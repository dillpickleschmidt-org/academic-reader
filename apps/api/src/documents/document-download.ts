import { Effect } from "effect"
import * as cheerio from "cheerio"
import type { CheerioAPI } from "cheerio"
import { minify } from "html-minifier-terser"
import type { ConvexSession } from "../services/convex-client"
import type { StorageService } from "../services/storage"
import { escapeHtml } from "../utils/sanitize"
import {
  extractKatexFontUsage,
  embedSourceSans,
  subsetKatexFonts,
  getKatexCssRules,
} from "../utils/font-subsetting"
import baseResultCss from "../styles/base-result.css" with { type: "text" }
import copyTexScript from "katex/dist/contrib/copy-tex.min.js" with { type: "text" }
import { documentLocation, contentHtmlKey, imageKey } from "./document-storage"
import { imageMimeType } from "./document-images"

const katexCssRules = getKatexCssRules()

export function generateDocumentDownload(options: {
  storage: StorageService
  convex: ConvexSession
  documentId: string
  title: string
  tabIndent: boolean
}) {
  return Effect.gen(function* () {
    const doc = yield* Effect.tryPromise({
      try: () => options.convex.getDocument(options.documentId),
      catch: (e) => e as Error,
    })
    const location = documentLocation(doc, options.documentId)
    const html = yield* options.storage.readFileAsString(contentHtmlKey(location))
    const $ = cheerio.load(html)
    yield* embedImagesFromStorage(options.storage, $, location).pipe(Effect.ignore)

    const katexFontUsage = extractKatexFontUsage($)
    const [sourceSansCss, katexFontsCss] = yield* Effect.tryPromise({
      try: () => Promise.all([embedSourceSans(), subsetKatexFonts(katexFontUsage)]),
      catch: (e) => e as Error,
    })

    const finalHtml = $("body").html() || html
    const title = options.title || doc.filename.replace(/\.[^/.]+$/, "")
    const fullHtml = generateHtmlDocument(
      finalHtml,
      title,
      `${sourceSansCss}\n${katexFontsCss}`,
      katexCssRules,
      getHtmlResultCss(options.tabIndent),
    )

    return yield* Effect.tryPromise({
      try: () =>
        minify(fullHtml, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
        }),
      catch: (e) => e as Error,
    })
  })
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
  <div class="reader-output">
    <div class="reader-content">
${renderedContent}
    </div>
  </div>
  <script>${copyTexScript.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`
}

function embedImagesFromStorage(
  storage: StorageService,
  $: CheerioAPI,
  location: { userId: string; documentId: string },
) {
  return Effect.gen(function* () {
    const images = $("img").toArray()
    yield* Effect.all(
      images.map((el) =>
        Effect.gen(function* () {
          const src = $(el).attr("src")
          if (!src) return
          const filename = imageFilename(src)
          if (!filename) return
          const buffer = yield* storage.readFile(imageKey(location, filename))
          const base64 = buffer.toString("base64")
          $(el).attr("src", `data:${imageMimeType(filename)};base64,${base64}`)
        }).pipe(Effect.catch(() => Effect.void)),
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
