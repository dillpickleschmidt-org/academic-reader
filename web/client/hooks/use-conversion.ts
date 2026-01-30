import { useState, useRef, useCallback, useEffect } from "react"
import {
  uploadFile as apiUploadFile,
  startConversion as apiStartConversion,
  cancelJob as apiCancelJob,
  subscribeToJob,
  type ConversionProgress,
  type ProcessingMode,
  type ChunkBlock,
  type TocResult,
} from "@repo/core/client/api-client"
import { downloadFile } from "@repo/core/client/download"
import { authClient } from "@repo/convex/auth-client"
import { useAppConfig } from "./use-app-config"
import { preloadResultPage } from "../utils/preload"

const PENDING_CONVERSION_KEY = "pendingConversion"

interface PendingConversionState {
  fileId: string
  fileName: string
  fileMimeType: string
  pageCount?: number
  processingMode: ProcessingMode
  useLlm: boolean
  pageRange: string
}

function savePendingState(state: PendingConversionState): void {
  sessionStorage.setItem(PENDING_CONVERSION_KEY, JSON.stringify(state))
}

function loadPendingState(): PendingConversionState | null {
  const saved = sessionStorage.getItem(PENDING_CONVERSION_KEY)
  if (!saved) return null
  return JSON.parse(saved)
}

function clearPendingState(): void {
  sessionStorage.removeItem(PENDING_CONVERSION_KEY)
}

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
  const { data: session, isPending: isSessionPending } = authClient.useSession()

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

  // Pending conversion state (for auth-required flow)
  const [pendingConversion, setPendingConversion] = useState(false)

  // Check for OAuth resume state on mount (only runs once)
  const pendingStateRef = useRef<PendingConversionState | null | undefined>(
    undefined,
  )
  if (pendingStateRef.current === undefined) {
    pendingStateRef.current = loadPendingState()
  }

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
    setPendingConversion(false)
    clearPendingState()
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

  const startConversion = async (options?: {
    skipAuthCheck?: boolean
    params?: PendingConversionState
  }) => {
    const params = options?.params ?? {
      fileId,
      fileName,
      fileMimeType,
      pageCount,
      processingMode,
      useLlm,
      pageRange,
    }

    // Require authentication to convert (skip if just authenticated or resuming OAuth)
    if (!options?.skipAuthCheck && !user) {
      savePendingState(params)
      setPendingConversion(true)
      return
    }

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
    setPendingConversion(false)

    try {
      const { job_id } = await apiStartConversion(
        params.fileId,
        params.fileName,
        params.fileMimeType,
        {
          processingMode: params.processingMode,
          useLlm: params.useLlm,
          pageRange: params.pageRange,
        },
      )
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

          // documentId is returned inline from SSE
          if (result.documentId) {
            setDocumentId(result.documentId)
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

  // Resume conversion after OAuth redirect
  useEffect(() => {
    const saved = pendingStateRef.current
    if (!saved || isSessionPending || !session?.user) return

    // Clear sessionStorage to prevent double-resume on refresh
    clearPendingState()

    // Restore UI state for display
    setFileId(saved.fileId)
    setFileName(saved.fileName)
    setFileMimeType(saved.fileMimeType)
    setPageCount(saved.pageCount)
    setProcessingMode(saved.processingMode)
    setUseLlm(saved.useLlm)
    setPageRange(saved.pageRange)
    setUploadComplete(true)

    // Start conversion with saved params
    startConversion({ skipAuthCheck: true, params: saved })

    // Clear ref after state updates are flushed
    setTimeout(() => {
      pendingStateRef.current = null
    }, 0)
  }, [session, isSessionPending])

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
      setToc(data.toc)
      // Transform Convex chunks to ChunkBlock format for TTS
      setChunks(
        data.chunks?.map(
          (c: {
            blockId: string
            blockType: string
            html: string
            page: number
          }) => ({
            id: c.blockId,
            block_type: c.blockType,
            html: c.html,
            page: c.page,
            polygon: [],
            bbox: [],
          }),
        ) ?? [],
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
    // Pending conversion (auth required)
    pendingConversion,
    hasPendingOAuthResume: pendingStateRef.current != null,

    // Setters
    setPage,
    setProcessingMode,
    setUseLlm,
    setPageRange,
    setPendingConversion,

    // Actions
    reset,
    uploadFile,
    startConversion,
    cancelConversion,
    downloadResult: handleDownload,
    loadSavedDocument,
  }
}
