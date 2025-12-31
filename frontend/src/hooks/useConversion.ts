import { useState, useRef } from "react"
import * as api from "../api"
import type { ConversionProgress } from "../api"
import { downloadResult, type OutputFormat } from "../utils/download"

export type Page = "upload" | "configure" | "processing" | "result"
export type { OutputFormat }

export interface StageInfo {
  stage: string
  current: number
  total: number
  elapsed: number
  completed: boolean
}

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
  const [stages, setStages] = useState<StageInfo[]>([])

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
    setStages([])
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
    setStages([])

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
        // onProgress - update stages
        (progress: ConversionProgress) => {
          sseConnected = true
          setStages((prev) => {
            const existing = prev.find((s) => s.stage === progress.stage)
            if (existing) {
              // Update existing stage
              return prev.map((s) =>
                s.stage === progress.stage
                  ? { ...progress, completed: progress.current >= progress.total }
                  : s
              )
            }
            // New stage - mark all previous as completed with current=total
            const updated = prev.map((s) => ({
              ...s,
              completed: true,
              current: s.total,
            }))
            return [...updated, { ...progress, completed: false }]
          })
        },
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

  const handleDownload = () => {
    downloadResult(content, fileName, outputFormat)
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
    stages,

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
    downloadResult: handleDownload,
  }
}
