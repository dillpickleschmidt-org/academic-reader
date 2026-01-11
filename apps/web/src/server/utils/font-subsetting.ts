/** Font subsetting for offline HTML downloads. Uses fonteditor-core with Bun. */
import * as cheerio from "cheerio"
import { woff2, Font } from "fonteditor-core"

import sourceSans3Font from "../fonts/SourceSans3-Latin.woff2"
import katexMainRegular from "../fonts/katex/KaTeX_Main-Regular.woff2"
import katexMainBold from "../fonts/katex/KaTeX_Main-Bold.woff2"
import katexMainItalic from "../fonts/katex/KaTeX_Main-Italic.woff2"
import katexMainBoldItalic from "../fonts/katex/KaTeX_Main-BoldItalic.woff2"
import katexMathItalic from "../fonts/katex/KaTeX_Math-Italic.woff2"
import katexMathBoldItalic from "../fonts/katex/KaTeX_Math-BoldItalic.woff2"
import katexAmsRegular from "../fonts/katex/KaTeX_AMS-Regular.woff2"
import katexCaligraphicRegular from "../fonts/katex/KaTeX_Caligraphic-Regular.woff2"
import katexCaligraphicBold from "../fonts/katex/KaTeX_Caligraphic-Bold.woff2"
import katexFrakturRegular from "../fonts/katex/KaTeX_Fraktur-Regular.woff2"
import katexFrakturBold from "../fonts/katex/KaTeX_Fraktur-Bold.woff2"
import katexSansSerifRegular from "../fonts/katex/KaTeX_SansSerif-Regular.woff2"
import katexSansSerifBold from "../fonts/katex/KaTeX_SansSerif-Bold.woff2"
import katexSansSerifItalic from "../fonts/katex/KaTeX_SansSerif-Italic.woff2"
import katexScriptRegular from "../fonts/katex/KaTeX_Script-Regular.woff2"
import katexTypewriterRegular from "../fonts/katex/KaTeX_Typewriter-Regular.woff2"
import katexSize1Regular from "../fonts/katex/KaTeX_Size1-Regular.woff2"
import katexSize2Regular from "../fonts/katex/KaTeX_Size2-Regular.woff2"
import katexSize3Regular from "../fonts/katex/KaTeX_Size3-Regular.woff2"
import katexSize4Regular from "../fonts/katex/KaTeX_Size4-Regular.woff2"

import katexCss from "katex/dist/katex.min.css" with { type: "text" }
import woff2WasmPath from "../wasm/woff2.wasm"

/** Load font buffer from file path */
async function loadBuffer(fontPath: string): Promise<ArrayBuffer> {
  try {
    return await Bun.file(fontPath).arrayBuffer()
  } catch (error) {
    throw new Error(`Failed to load font buffer from ${fontPath}: ${error}`)
  }
}

let woff2Initialized = false

/** Initialize woff2 WASM module */
async function ensureWoff2Init(): Promise<void> {
  if (woff2Initialized) return

  let wasmBuffer: ArrayBuffer
  try {
    wasmBuffer = await Bun.file(woff2WasmPath).arrayBuffer()
  } catch (error) {
    throw new Error(
      `Failed to load woff2 WASM from ${woff2WasmPath}: ${error instanceof Error ? error.message : error}`,
    )
  }

  try {
    await woff2.init(wasmBuffer)
  } catch (error) {
    throw new Error(
      `Failed to initialize woff2 WASM: ${error instanceof Error ? error.message : error}`,
    )
  }

  woff2Initialized = true
}

/** Subset font to specified characters, returns WOFF2 */
async function subsetFontBuffer(
  fontBuffer: ArrayBuffer,
  chars: string,
): Promise<ArrayBuffer> {
  await ensureWoff2Init()

  const codePoints = [...new Set(chars)].map((c) => c.codePointAt(0)!)

  const font = Font.create(fontBuffer, {
    type: "woff2",
    subset: codePoints,
    hinting: true,
    kerning: true,
  })

  const ttfResult = font.write({ type: "ttf", hinting: true, kerning: true })
  const ttfBuffer =
    ttfResult instanceof ArrayBuffer
      ? ttfResult
      : ((ttfResult as Buffer).buffer as ArrayBuffer)

  const woff2Result = woff2.encode(ttfBuffer)
  if (woff2Result instanceof ArrayBuffer) return woff2Result

  const bytes = woff2Result as Uint8Array
  const copy = new ArrayBuffer(bytes.length)
  new Uint8Array(copy).set(bytes)
  return copy
}

// KaTeX class → font properties (derived from KaTeX CSS)
const KATEX_FONT_MAP: Record<
  string,
  { family: string; weight: string; style: string }
> = {
  mathnormal: { family: "KaTeX_Math", weight: "400", style: "italic" },
  mathit: { family: "KaTeX_Main", weight: "400", style: "italic" },
  mathrm: { family: "KaTeX_Main", weight: "400", style: "normal" },
  mathbf: { family: "KaTeX_Main", weight: "700", style: "normal" },
  boldsymbol: { family: "KaTeX_Math", weight: "700", style: "italic" },
  mathboldfrak: { family: "KaTeX_Fraktur", weight: "700", style: "normal" },
  mathboldsf: { family: "KaTeX_SansSerif", weight: "700", style: "normal" },
  mathitsf: { family: "KaTeX_SansSerif", weight: "400", style: "italic" },
  mainrm: { family: "KaTeX_Main", weight: "400", style: "normal" },
  textrm: { family: "KaTeX_Main", weight: "400", style: "normal" },
  textbf: { family: "KaTeX_Main", weight: "700", style: "normal" },
  textit: { family: "KaTeX_Main", weight: "400", style: "italic" },
  textsf: { family: "KaTeX_SansSerif", weight: "400", style: "normal" },
  texttt: { family: "KaTeX_Typewriter", weight: "400", style: "normal" },
  textboldsf: { family: "KaTeX_SansSerif", weight: "700", style: "normal" },
  textitsf: { family: "KaTeX_SansSerif", weight: "400", style: "italic" },
  textfrak: { family: "KaTeX_Fraktur", weight: "400", style: "normal" },
  textboldfrak: { family: "KaTeX_Fraktur", weight: "700", style: "normal" },
  textscr: { family: "KaTeX_Script", weight: "400", style: "normal" },
  textbb: { family: "KaTeX_AMS", weight: "400", style: "normal" },
  amsrm: { family: "KaTeX_AMS", weight: "400", style: "normal" },
  mathbb: { family: "KaTeX_AMS", weight: "400", style: "normal" },
  mathcal: { family: "KaTeX_Caligraphic", weight: "400", style: "normal" },
  mathfrak: { family: "KaTeX_Fraktur", weight: "400", style: "normal" },
  mathtt: { family: "KaTeX_Typewriter", weight: "400", style: "normal" },
  mathscr: { family: "KaTeX_Script", weight: "400", style: "normal" },
  mathsf: { family: "KaTeX_SansSerif", weight: "400", style: "normal" },
  "delimsizing size1": {
    family: "KaTeX_Size1",
    weight: "400",
    style: "normal",
  },
  "delimsizing size2": {
    family: "KaTeX_Size2",
    weight: "400",
    style: "normal",
  },
  "delimsizing size3": {
    family: "KaTeX_Size3",
    weight: "400",
    style: "normal",
  },
  "delimsizing size4": {
    family: "KaTeX_Size4",
    weight: "400",
    style: "normal",
  },
  "delim-size1": { family: "KaTeX_Size1", weight: "400", style: "normal" },
  "delim-size4": { family: "KaTeX_Size4", weight: "400", style: "normal" },
  "small-op": { family: "KaTeX_Size1", weight: "400", style: "normal" },
  "large-op": { family: "KaTeX_Size2", weight: "400", style: "normal" },
}

// Font key → imported font path
const FONT_DATA: Record<string, string> = {
  "KaTeX_Main|normal|400": katexMainRegular,
  "KaTeX_Main|normal|700": katexMainBold,
  "KaTeX_Main|italic|400": katexMainItalic,
  "KaTeX_Main|italic|700": katexMainBoldItalic,
  "KaTeX_Math|italic|400": katexMathItalic,
  "KaTeX_Math|italic|700": katexMathBoldItalic,
  "KaTeX_AMS|normal|400": katexAmsRegular,
  "KaTeX_Caligraphic|normal|400": katexCaligraphicRegular,
  "KaTeX_Caligraphic|normal|700": katexCaligraphicBold,
  "KaTeX_Fraktur|normal|400": katexFrakturRegular,
  "KaTeX_Fraktur|normal|700": katexFrakturBold,
  "KaTeX_SansSerif|normal|400": katexSansSerifRegular,
  "KaTeX_SansSerif|normal|700": katexSansSerifBold,
  "KaTeX_SansSerif|italic|400": katexSansSerifItalic,
  "KaTeX_Script|normal|400": katexScriptRegular,
  "KaTeX_Typewriter|normal|400": katexTypewriterRegular,
  "KaTeX_Size1|normal|400": katexSize1Regular,
  "KaTeX_Size2|normal|400": katexSize2Regular,
  "KaTeX_Size3|normal|400": katexSize3Regular,
  "KaTeX_Size4|normal|400": katexSize4Regular,
}

/** Extract KaTeX font usage from HTML. Returns map of font key → characters used. */
export function extractKatexFontUsage(
  $: cheerio.CheerioAPI,
): Record<string, Set<string>> {
  const fontChars: Record<string, Set<string>> = {}
  const defaultFont = { family: "KaTeX_Main", weight: "400", style: "normal" }

  $(".katex-html")
    .find("*")
    .each((_, el) => {
      const $el = $(el)
      const classes = ($el.attr("class") || "").split(/\s+/).filter(Boolean)

      // Get direct text content only
      let text = ""
      $el.contents().each((_, node) => {
        if (node.type === "text") text += $(node).text()
      })
      if (!text.trim()) return

      let font = defaultFont

      // Check multi-class patterns first (e.g. "delimsizing size1")
      for (const [pattern, fontProps] of Object.entries(KATEX_FONT_MAP)) {
        if (pattern.includes(" ")) {
          const parts = pattern.split(" ")
          if (parts.every((p) => classes.includes(p))) {
            font = fontProps
            break
          }
        }
      }

      // Then single classes
      if (font === defaultFont) {
        for (const cls of classes) {
          if (KATEX_FONT_MAP[cls]) {
            font = KATEX_FONT_MAP[cls]
            break
          }
        }
      }

      const key = `${font.family}|${font.style}|${font.weight}`
      if (!fontChars[key]) fontChars[key] = new Set()

      for (const char of text) {
        fontChars[key].add(char)
      }
    })

  return fontChars
}

/** Embed full Source Sans 3 (~28KB). Not subsetted: would strip variable font axes and be larger. */
export async function embedSourceSans(): Promise<string> {
  try {
    const fontBuffer = await loadBuffer(sourceSans3Font)
    const base64 = Buffer.from(fontBuffer).toString("base64")
    const dataUri = `data:font/woff2;base64,${base64}`

    return `@font-face {
  font-family: 'Source Sans 3';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url(${dataUri}) format('woff2');
}`
  } catch (e) {
    console.error("Failed to embed Source Sans 3:", e)
    return "/* Source Sans 3 embedding failed */"
  }
}

/** Subset KaTeX fonts to used characters. Returns CSS with embedded fonts. */
export async function subsetKatexFonts(
  fontUsage: Record<string, Set<string>>,
): Promise<string> {
  const cssBlocks: string[] = []

  for (const [fontKey, chars] of Object.entries(fontUsage)) {
    const fontData = FONT_DATA[fontKey]
    if (!fontData) {
      console.warn(`Unknown font key: ${fontKey}`)
      continue
    }

    const uniqueChars = [...chars].join("")
    if (!uniqueChars) continue

    try {
      const fontBuffer = await loadBuffer(fontData)
      const subsetBuffer = await subsetFontBuffer(fontBuffer, uniqueChars)

      const base64 = Buffer.from(subsetBuffer).toString("base64")
      const dataUri = `data:font/woff2;base64,${base64}`

      const [family, style, weight] = fontKey.split("|")

      cssBlocks.push(`@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(${dataUri}) format('woff2');
}`)
    } catch (e) {
      console.warn(`Failed to subset ${fontKey}:`, e)
    }
  }

  return cssBlocks.join("\n")
}

/** Get KaTeX CSS rules (without @font-face declarations) */
export function getKatexCssRules(): string {
  return katexCss.replace(/@font-face\{[^}]+\}/g, "")
}
