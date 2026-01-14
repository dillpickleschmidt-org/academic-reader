import { useState, useRef, useCallback } from "react"
import {
  warmModels,
  uploadFile as apiUploadFile,
  fetchFromUrl as apiFetchFromUrl,
  startConversion as apiStartConversion,
  cancelJob as apiCancelJob,
  persistDocument as apiPersistDocument,
  subscribeToJob,
  type ConversionProgress,
  type OutputFormat,
  type ChunkBlock,
} from "@repo/core/client/api-client"
import { downloadFile, downloadContent } from "@repo/core/client/download"
import { useAppConfig } from "./use-app-config"

export type Page = "upload" | "configure" | "processing" | "result"
export type { OutputFormat, ChunkBlock }

export interface StageInfo {
  stage: string
  current: number
  total: number
  elapsed: number
  completed: boolean
}

export function useConversion() {
  // Auth state
  const { user } = useAppConfig()

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
  const [jobId, setJobId] = useState("")
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [imagesReady, setImagesReady] = useState(false)
  const [stages, setStages] = useState<StageInfo[]>([])

  // Document context for AI chat (RAG)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<ChunkBlock[]>([])
  const [markdown, setMarkdown] = useState("")

  // SSE cleanup ref
  const sseCleanupRef = useRef<(() => void) | null>(null)

  // Cancellation state
  const [isCancelling, setIsCancelling] = useState(false)

  // Shared stage update logic for SSE and polling
  const updateStages = useCallback((progress: ConversionProgress) => {
    setStages((prev) => {
      const stageInfo: StageInfo = {
        ...progress,
        completed: progress.current >= progress.total,
      }
      const existing = prev.find((s) => s.stage === progress.stage)
      if (existing) {
        return prev.map((s) => (s.stage === progress.stage ? stageInfo : s))
      }
      return [
        ...prev.map((s) => ({ ...s, completed: true, current: s.total })),
        { ...stageInfo, completed: false },
      ]
    })
  }, [])

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
    setJobId("")
    setContent("")
    setError("")
    setImagesReady(false)
    setStages([])
    setDocumentId(null)
    setChunks([])
    setMarkdown("")
  }

  const uploadFile = async (file: File) => {
    setFileName(file.name)
    setPage("configure")
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

    // Pre-warm models when upload starts (fire-and-forget)
    warmModels()

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90))
    }, 200)

    try {
      const data = await apiUploadFile(file)

      setFileId(data.file_id)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setPage("upload")
    } finally {
      clearInterval(progressInterval)
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
    warmModels()

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 5, 90))
    }, 300)

    try {
      const data = await apiFetchFromUrl(url)

      setFileId(data.file_id)
      setFileName(data.filename)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch URL")
      setPage("upload")
    } finally {
      clearInterval(progressInterval)
    }
  }

  const startConversion = async () => {
    // Clean up any existing SSE before starting new one
    if (sseCleanupRef.current) {
      sseCleanupRef.current()
      sseCleanupRef.current = null
    }

    setPage("processing")
    setError("")
    setImagesReady(false)
    setStages([])

    try {
      const { job_id } = await apiStartConversion(fileId, fileName, {
        outputFormat,
        useLlm,
        forceOcr,
        pageRange,
      })
      setJobId(job_id)

      const cleanup = subscribeToJob(
        job_id,
        (progress: ConversionProgress) => updateStages(progress),
        (htmlContent) => {
          setContent(htmlContent)
          setPage("result")
        },
        async (result) => {
          setContent(result.content)
          setImagesReady(true)

          // Persist document if user is authenticated
          if (user && result.jobId) {
            try {
              const { documentId } = await apiPersistDocument(result.jobId)
              setDocumentId(documentId)
            } catch (err) {
              // Persistence failed - continue without documentId
              console.warn("[persistence] Failed to persist document:", err)
            }
          }

          // Extract chunks and markdown for AI chat
          if (result.formats?.chunks?.blocks) {
            setChunks(result.formats.chunks.blocks)
          }
          if (result.formats?.markdown) {
            setMarkdown(result.formats.markdown)
          }
          setPage("result")
          sseCleanupRef.current = null
        },
        (errorMsg) => {
          setError(errorMsg)
          sseCleanupRef.current = null
        },
      )

      sseCleanupRef.current = cleanup
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed")
    }
  }

  const handleDownload = async () => {
    try {
      if (outputFormat === "html" && fileId) {
        await downloadFile(fileId, fileName)
      } else {
        downloadContent(content, fileName, outputFormat)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed")
    }
  }

  const cancelConversion = async () => {
    // Close SSE connection first
    if (sseCleanupRef.current) {
      sseCleanupRef.current()
      sseCleanupRef.current = null
    }

    if (!jobId) {
      setPage("configure")
      return
    }

    setIsCancelling(true)

    try {
      await apiCancelJob(jobId)
    } catch {
      // Best-effort - redirect even on error
    }

    // Reset to configure page
    setIsCancelling(false)
    setPage("configure")
    setJobId("")
    setStages([])
    setError("")
  }

  const loadSavedDocument = async (docId: string, filename: string) => {
    setError("")
    setFileName(filename)

    try {
      const response = await fetch(`/api/saved-documents/${docId}`, {
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load document")
      }

      const data = await response.json()
      setContent(data.html)
      setMarkdown(data.markdown || "")
      setDocumentId(docId)
      setFileId(data.storageId)
      setOutputFormat("html")
      setImagesReady(true)
      // Transform Convex chunks to ChunkBlock format for TTS
      if (data.chunks) {
        const transformedChunks = data.chunks.map((c: { blockId: string; blockType: string; content: string; page: number }) => ({
          id: c.blockId,
          block_type: c.blockType,
          html: c.content, // Convex stores stripped content, use as-is
          page: c.page,
          polygon: [],
          bbox: [],
        }))
        setChunks(transformedChunks)
      }
      setPage("result")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document")
    }
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
    isCancelling,
    // Document context for AI chat
    documentId,
    chunks,
    markdown,

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
    cancelConversion,
    downloadResult: handleDownload,
    loadSavedDocument,
  }
}
