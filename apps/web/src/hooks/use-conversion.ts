import { useState, useRef, useCallback, useEffect } from "react"
import { Effect, Fiber, Stream } from "effect"
import {
  uploadFile as apiUploadFile,
  startConversion as apiStartConversion,
  cancelJob as apiCancelJob,
  subscribeToJobStream,
  downloadFile,
  loadSavedDocument as apiLoadSavedDocument,
} from "@academic-reader/api-client/client"
import type { ConversionProgress } from "@academic-reader/api-client/schemas/job"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import type {
  ChunkBlock,
  TocResult,
} from "@academic-reader/api-client/schemas/document"
import { authClient } from "@academic-reader/convex/auth-client"
import { AppRuntime } from "@/lib/runtime"
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

  // SSE fiber ref
  const sseFiberRef = useRef<Fiber.RuntimeFiber<void> | null>(null)
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
      return [...prev, stageInfo]
    })
  }, [])

  const reset = () => {
    if (sseFiberRef.current) {
      Effect.runFork(Fiber.interrupt(sseFiberRef.current))
      sseFiberRef.current = null
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
      const data = await AppRuntime.runPromise(apiUploadFile(file))

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

    if (sseFiberRef.current) {
      Effect.runFork(Fiber.interrupt(sseFiberRef.current))
      sseFiberRef.current = null
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
      const { job_id } = await AppRuntime.runPromise(
        apiStartConversion(
          params.fileId,
          params.fileName,
          params.fileMimeType,
          {
            processingMode: params.processingMode,
            useLlm: params.useLlm,
            pageRange: params.pageRange,
          },
        ),
      )
      setJobId(job_id)

      sseFiberRef.current = AppRuntime.runFork(
        subscribeToJobStream(job_id).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              switch (event._tag) {
                case "Progress":
                  updateStages(event.progress)
                  break
                case "HtmlReady":
                  htmlReadyFiredRef.current = true
                  setContent(event.content)
                  setPage("result")
                  break
                case "Completed":
                  setContent(event.result.content)
                  if (!htmlReadyFiredRef.current) setPage("result")
                  setImagesReady(true)
                  setChunks([...(event.result.formats?.chunks?.blocks ?? [])])
                  setToc(event.result.toc)
                  if (event.result.documentId)
                    setDocumentId(event.result.documentId)
                  break
                case "Failed":
                  setError(event.error)
                  break
              }
            }),
          ),
          Effect.catchAll((error) =>
            Effect.sync(() => setError(String(error))),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              sseFiberRef.current = null
            }),
          ),
        ),
      )
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
    if (sseFiberRef.current) {
      Effect.runFork(Fiber.interrupt(sseFiberRef.current))
      sseFiberRef.current = null
    }

    if (!jobId) {
      setPage("configure")
      return
    }

    setIsCancelling(true)

    try {
      await AppRuntime.runPromise(apiCancelJob(jobId))
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
      const data = await AppRuntime.runPromise(apiLoadSavedDocument(docId))
      setContent(data.html)
      setDocumentId(docId)
      setFileId(data.storageId)
      setImagesReady(true)
      setToc(data.toc)
      // Transform Convex chunks to ChunkBlock format for TTS
      setChunks(
        data.chunks?.map((c) => ({
          id: c.blockId,
          block_type: c.blockType,
          html: c.html,
          polygon: [] as number[][],
          bbox: [] as number[],
          includeTts: c.includeTts,
          ttsText: c.ttsText,
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
