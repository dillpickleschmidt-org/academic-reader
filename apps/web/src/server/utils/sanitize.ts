/**
 * Sanitization utilities for user input and file handling.
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Not strictly necessary - users can only see their own content anyway.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Sanitize a document title for display.
 * Removes control characters and limits length.
 */
export function sanitizeTitle(title: string, maxLength = 200): string {
  return (
    title
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .slice(0, maxLength) || "Document"
  )
}

/**
 * Convert a title to ASCII-safe filename for Content-Disposition header.
 * Used for legacy clients that don't support RFC 5987 encoding.
 */
export function toAsciiFilename(title: string): string {
  return title
    .replace(/[^\x20-\x7E]/g, "_") // Replace non-ASCII with underscore
    .replace(/["\\]/g, "\\$&") // Escape quotes and backslashes
}

/**
 * Sanitize a filename for display/logging.
 * Removes control characters, limits length. Preserves unicode and spaces.
 * NOT for use in file paths - use a generated ID for storage keys.
 */
export function sanitizeFilename(
  rawFilename: string,
  fallback = "document.pdf",
): string {
  return (
    rawFilename
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .slice(0, 255) || fallback
  )
}

/**
 * Generate Content-Disposition header value for file downloads.
 * Includes both ASCII fallback and RFC 5987 encoded UTF-8 filename.
 */
export function contentDisposition(
  filename: string,
  type: "attachment" | "inline" = "attachment",
): string {
  const ascii = toAsciiFilename(filename)
  const encoded = encodeURIComponent(filename)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
