/**
 * Download utilities for saving conversion results.
 * HTML downloads use server-side font subsetting for optimal file size.
 */

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")

export type OutputFormat = "html" | "markdown" | "json"

export const getDownloadExtension = (format: OutputFormat): string =>
  format === "html" ? "html" : format === "json" ? "json" : "md"

export const getDownloadMimeType = (format: OutputFormat): string =>
  format === "html"
    ? "text/html"
    : format === "json"
      ? "application/json"
      : "text/markdown"

const downloadBlob = (
  content: string | Blob,
  filename: string,
  mimeType: string,
) => {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Download HTML from the API with server-side font subsetting.
 * Uses direct link to show native browser download progress.
 */
export const downloadFromApi = (jobId: string, fileName: string): void => {
  const baseName = fileName.replace(/\.[^/.]+$/, "")
  const url = `${API_URL}/api/jobs/${jobId}/download?title=${encodeURIComponent(baseName)}`

  const a = document.createElement("a")
  a.href = url
  a.click()
}

/**
 * Download non-HTML content (markdown, json) directly.
 */
export const downloadContent = (
  content: string,
  fileName: string,
  outputFormat: OutputFormat,
): void => {
  const ext = getDownloadExtension(outputFormat)
  const mimeType = getDownloadMimeType(outputFormat)
  const baseName = fileName.replace(/\.[^/.]+$/, "")
  downloadBlob(content, `${baseName}.${ext}`, mimeType)
}
