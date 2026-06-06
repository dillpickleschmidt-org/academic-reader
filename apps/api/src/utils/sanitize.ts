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
  return `${type}; filename="${quotedAsciiFilename(filename)}"; filename*=UTF-8''${encodeRfc5987Value(filename)}`
}

export function stripHtml(html: string): string {
  return load(html).text().replace(/\s+/g, " ").trim()
}

function quotedAsciiFilename(filename: string): string {
  const fallback = filename
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/]/g, "_")
    .replace(/"/g, "\\\"")
  return fallback || "download"
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
