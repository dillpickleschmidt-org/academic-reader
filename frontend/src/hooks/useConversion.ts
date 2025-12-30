import { useState, useRef } from "react"
import * as api from "../api"
import baseResultCss from "../styles/base-result.css?raw"
import htmlResultCss from "../styles/html-result.css?raw"

export type Page = "upload" | "configure" | "processing" | "result"
export type OutputFormat = "html" | "markdown" | "json"

const POLL_INTERVAL = 10000 // 10 seconds fallback

export function useConversion() {
  // Navigation
  const [page, setPage] = useState<Page>("upload")

  // File state
  const [fileId, setFileId] = useState("")
  const [fileName, setFileName] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [url, setUrl] = useState("")

  // Config options
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("html")
  const [useLlm, setUseLlm] = useState(false)
  const [forceOcr, setForceOcr] = useState(false)
  const [pageRange, setPageRange] = useState("")

  // Processing state
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [imagesReady, setImagesReady] = useState(false)

  // SSE cleanup ref
  const sseCleanupRef = useRef<(() => void) | null>(null)

  const reset = () => {
    // Clean up any active SSE connection
    if (sseCleanupRef.current) {
      sseCleanupRef.current()
      sseCleanupRef.current = null
    }

    setPage("upload")
    setFileId("")
    setFileName("")
    setUploadProgress(0)
    setUploadComplete(false)
    setUrl("")
    setOutputFormat("html")
    setUseLlm(false)
    setForceOcr(false)
    setPageRange("")
    setContent("")
    setError("")
    setImagesReady(false)
  }

  const uploadFile = async (file: File) => {
    setFileName(file.name)
    setPage("configure")
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

    // Pre-warm models when upload starts (fire-and-forget)
    api.warmModels()

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90))
      }, 200)

      const data = await api.uploadFile(file)

      clearInterval(progressInterval)
      setFileId(data.file_id)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setPage("upload")
    }
  }

  const fetchFromUrl = async () => {
    if (!url.trim()) return

    setFileName(url.split("/").pop()?.split("?")[0] || "document")
    setPage("configure")
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

    // Pre-warm models when fetch starts (fire-and-forget)
    api.warmModels()

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 5, 90))
      }, 300)

      const data = await api.fetchFromUrl(url)

      clearInterval(progressInterval)
      setFileId(data.file_id)
      setFileName(data.filename)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch URL")
      setPage("upload")
    }
  }

  const startConversion = async () => {
    setPage("processing")
    setError("")
    setImagesReady(false)

    try {
      const { job_id } = await api.startConversion(fileId, {
        outputFormat,
        useLlm,
        forceOcr,
        pageRange,
      })

      // Try SSE first, fall back to polling if it fails
      let sseConnected = false
      let sseFailed = false

      const cleanup = api.subscribeToJob(
        job_id,
        // onHtmlReady - show content immediately (images still loading)
        (htmlContent) => {
          sseConnected = true
          setContent(htmlContent)
          setPage("result")
          // imagesReady stays false - shimmer will show for unloaded images
        },
        // onComplete - final content with images embedded
        (result) => {
          sseConnected = true
          setContent(result.content)
          setImagesReady(true)
          setPage("result")
          sseCleanupRef.current = null
        },
        // onError
        (errorMsg) => {
          if (sseConnected) {
            // Error after connection - show error
            setError(errorMsg)
          } else {
            // Connection failed - will fall back to polling
            sseFailed = true
          }
          sseCleanupRef.current = null
        },
      )

      sseCleanupRef.current = cleanup

      // Give SSE a moment to connect, then start polling as fallback
      setTimeout(() => {
        if (!sseConnected && !sseFailed) {
          // SSE hasn't connected yet - start polling fallback
          pollJobFallback(job_id)
        } else if (sseFailed) {
          // SSE failed - use polling
          pollJobFallback(job_id)
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed")
    }
  }

  const pollJobFallback = async (jobId: string): Promise<void> => {
    try {
      const job = await api.getJobStatus(jobId)

      if (job.status === "completed") {
        setContent(job.result?.content || "")
        setImagesReady(true)
        setPage("result")
      } else if (job.status === "failed") {
        setError(job.error || "Conversion failed")
      } else {
        // Still processing - poll again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
        return pollJobFallback(jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check status")
    }
  }

  const downloadResult = () => {
    const ext =
      outputFormat === "html" ? "html" : outputFormat === "json" ? "json" : "md"
    const mimeType =
      outputFormat === "html"
        ? "text/html"
        : outputFormat === "json"
          ? "application/json"
          : "text/markdown"

    let downloadContent = content

    // Wrap HTML in a full document with inline styles and theme toggle
    if (outputFormat === "html") {
      // Get the rendered DOM content (includes KaTeX-rendered math)
      const renderedContent =
        document.querySelector(".reader-content")?.innerHTML || content

      // SVG icons for theme toggle
      const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
      const bookIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`
      const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`

      downloadContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName.replace(/\.[^/.]+$/, "")}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>
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
      <label for="theme-light" title="Light">${sunIcon}</label>
      <label for="theme-comfort" title="Comfort">${bookIcon}</label>
      <label for="theme-dark" title="Dark">${moonIcon}</label>
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
</body>
</html>`
    }

    const blob = new Blob([downloadContent], { type: mimeType })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = `${fileName.replace(/\.[^/.]+$/, "")}.${ext}`
    a.click()
    URL.revokeObjectURL(blobUrl)
  }

  return {
    // State
    page,
    fileId,
    fileName,
    uploadProgress,
    uploadComplete,
    url,
    outputFormat,
    useLlm,
    forceOcr,
    pageRange,
    content,
    error,
    imagesReady,

    // Setters
    setUrl,
    setOutputFormat,
    setUseLlm,
    setForceOcr,
    setPageRange,

    // Actions
    reset,
    uploadFile,
    fetchFromUrl,
    startConversion,
    downloadResult,
  }
}
