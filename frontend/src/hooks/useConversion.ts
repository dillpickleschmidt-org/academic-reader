import { useState } from "react"
import * as api from "../api"
import baseResultCss from "../styles/base-result.css?raw"
import htmlResultCss from "../styles/html-result.css?raw"

export type Page = "upload" | "configure" | "processing" | "result"
export type OutputFormat = "html" | "markdown" | "json"

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

  const reset = () => {
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
  }

  const uploadFile = async (file: File) => {
    setFileName(file.name)
    setPage("configure")
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

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

    try {
      const { job_id } = await api.startConversion(fileId, {
        outputFormat,
        useLlm,
        forceOcr,
        pageRange,
      })

      const pollJob = async (): Promise<void> => {
        const job = await api.getJobStatus(job_id)

        if (job.status === "completed") {
          setContent(job.result?.content || "")
          setPage("result")
        } else if (job.status === "failed") {
          throw new Error(job.error || "Conversion failed")
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return pollJob()
        }
      }

      await pollJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed")
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

    // Wrap HTML in a full document with inline styles
    if (outputFormat === "html") {
      // Get the rendered DOM content (includes KaTeX-rendered math)
      const renderedContent =
        document.querySelector(".reader-content")?.innerHTML || content

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
<body class="reader-output">
  <div class="reader-content">
${renderedContent}
  </div>
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
