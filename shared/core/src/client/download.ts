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
