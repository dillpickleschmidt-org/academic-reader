import { load } from "cheerio"

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function sanitizeTitle(title: string, maxLength = 200): string {
  return title.replace(/[\x00-\x1F\x7F]/g, "").slice(0, maxLength) || "Document"
}

export function toAsciiFilename(title: string): string {
  return title.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "\\$&")
}

export function sanitizeFilename(
  rawFilename: string,
  fallback = "document.pdf",
): string {
  return rawFilename.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 255) || fallback
}

export function contentDisposition(
  filename: string,
  type: "attachment" | "inline" = "attachment",
): string {
  const ascii = toAsciiFilename(filename)
  const encoded = encodeURIComponent(filename)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export function stripHtml(html: string): string {
  return load(html).text().replace(/\s+/g, " ").trim()
}
