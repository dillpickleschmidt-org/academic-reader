import { useState, useRef, useCallback } from "react"
import {
  uploadFile as apiUploadFile,
  startConversion as apiStartConversion,
  cancelJob as apiCancelJob,
  persistDocument as apiPersistDocument,
  subscribeToJob,
  type ConversionProgress,
  type ProcessingMode,
  type ChunkBlock,
  type TocResult,
} from "@repo/core/client/api-client"
import { downloadFile } from "@repo/core/client/download"
import { useAppConfig } from "./use-app-config"
import { preloadResultPage } from "../utils/preload"

export type Page = "landing" | "configure" | "processing" | "result"
export type { ProcessingMode, ChunkBlock }

export interface StageInfo {
  stage: string
  current: number
  total: number
  completed: boolean
}

export function useConversion() {
  // Auth state
  const { user } = useAppConfig()

  // Navigation
  const [page, setPage] = useState<Page>("landing")

  // File state
  const [fileId, setFileId] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileMimeType, setFileMimeType] = useState("")
  const [pageCount, setPageCount] = useState<number | undefined>()
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadComplete, setUploadComplete] = useState(false)

  // Config options
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("fast")
  const [useLlm, setUseLlm] = useState(true)
  const [pageRange, setPageRange] = useState("")

  // Processing state
  const [jobId, setJobId] = useState("")
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [imagesReady, setImagesReady] = useState(false)
  const [stages, setStages] = useState<StageInfo[]>([])

  // Document context for AI chat (RAG)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<ChunkBlock[] | undefined>()

  // Table of contents from server
  const [toc, setToc] = useState<TocResult | undefined>()

  // SSE cleanup ref
  const sseCleanupRef = useRef<(() => void) | null>(null)
  const htmlReadyFiredRef = useRef(false)

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

    setPage("landing")
    setFileId("")
    setFileName("")
    setFileMimeType("")
    setPageCount(undefined)
    setUploadProgress(0)
    setUploadComplete(false)
    setProcessingMode("fast")
    setUseLlm(false)
    setPageRange("")
    setJobId("")
    setContent("")
    setError("")
    setImagesReady(false)
    setStages([])
    setDocumentId(null)
    setChunks(undefined)
    setToc(undefined)
  }

  const uploadFile = async (file: File) => {
    setFileName(file.name)
    setFileMimeType(file.type)
    setPage("configure")
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90))
    }, 200)

    try {
      const data = await apiUploadFile(file)

      setFileId(data.file_id)
      setPageCount(data.page_count)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setPage("landing")
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

    // Preload ResultPage chunk while processing
    preloadResultPage()

    setPage("processing")
    setError("")
    setImagesReady(false)
    setStages([])
    htmlReadyFiredRef.current = false

    try {
      const { job_id } = await apiStartConversion(fileId, fileName, fileMimeType, {
        processingMode,
        useLlm,
        pageRange,
      })
      setJobId(job_id)

      const cleanup = subscribeToJob(
        job_id,
        (progress: ConversionProgress) => updateStages(progress),
        (htmlContent) => {
          htmlReadyFiredRef.current = true
          setContent(htmlContent)
          setPage("result")
        },
        (result) => {
          // Always update content with final result (has rewritten image URLs)
          setContent(result.content)
          if (!htmlReadyFiredRef.current) {
            setPage("result")
          }

          setImagesReady(true)
          setChunks(result.formats?.chunks?.blocks ?? [])
          setToc(result.toc)
          sseCleanupRef.current = null

          // Fire-and-forget persistence (doesn't block render)
          if (user && result.jobId) {
            apiPersistDocument(result.jobId)
              .then(({ documentId }) => setDocumentId(documentId))
              .catch((err) =>
                console.warn("[persistence] Failed to persist document:", err),
              )
          }
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
      if (fileId) {
        await downloadFile(fileId, fileName)
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
      setDocumentId(docId)
      setFileId(data.storageId)
      setImagesReady(true)
      // Transform Convex chunks to ChunkBlock format for TTS
      setChunks(
        data.chunks?.map((c: { blockId: string; blockType: string; content: string; page: number }) => ({
          id: c.blockId,
          block_type: c.blockType,
          html: c.content,
          page: c.page,
          polygon: [],
          bbox: [],
        })) ?? [],
      )
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
    fileMimeType,
    pageCount,
    uploadProgress,
    uploadComplete,
    processingMode,
    useLlm,
    pageRange,
    content,
    error,
    imagesReady,
    stages,
    isCancelling,
    // Document context for AI chat
    documentId,
    chunks,
    // Table of contents
    toc,

    // Setters
    setPage,
    setProcessingMode,
    setUseLlm,
    setPageRange,

    // Actions
    reset,
    uploadFile,
    startConversion,
    cancelConversion,
    downloadResult: handleDownload,
    loadSavedDocument,
  }
}
