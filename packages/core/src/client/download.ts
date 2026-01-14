import type { OutputFormat } from "@repo/core/types/api"

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
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Download HTML from the API with server-side font subsetting.
 * In production, uses direct navigation for native download progress.
 * In dev, uses fetch + blob to work with Vite's proxy.
 */
export const downloadFile = async (
  fileId: string,
  fileName: string,
): Promise<void> => {
  const baseName = fileName.replace(/\.[^/.]+$/, "")
  const url = `/api/files/${fileId}/download?title=${encodeURIComponent(baseName)}`

  if (import.meta.env.PROD) {
    // Production: direct navigation shows native download progress
    window.location.href = url
    return
  }

  // Dev: fetch + blob to work with Vite's proxy (navigation bypasses proxy)
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    throw new Error("Download failed")
  }

  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)

  const a = document.createElement("a")
  a.href = blobUrl
  a.download = `${baseName}.html`
  a.click()

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}

/** @deprecated Use downloadFile instead */
export const downloadFromApi = downloadFile

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
