import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  uploadFile as apiUploadFile,
  createDocumentFromUpload,
} from "@academic-reader/api-client/client"
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import { authClient } from "@academic-reader/convex/auth-client"
import { AppRuntime } from "@/lib/runtime"
import { useAppConfig } from "./use-app-config"
import { readNarratorVoice } from "./use-narrator-voice"

const PENDING_DOCUMENT_KEY = "pendingDocumentCreation"

interface PendingDocumentState {
  fileId: string
  fileName: string
  fileMimeType: string
  fileSize: number
  pageCount: number | null
  processingMode: ProcessingMode
  useLlm: boolean
  forceOcr: boolean
  pageRange: string
  audioVoiceId: string
}

function loadPendingState(): PendingDocumentState | null {
  const saved = sessionStorage.getItem(PENDING_DOCUMENT_KEY)
  if (!saved) return null
  return JSON.parse(saved)
}

function clearPendingState(): void {
  sessionStorage.removeItem(PENDING_DOCUMENT_KEY)
}

export function useDocumentCreation() {
  const navigate = useNavigate()
  const { user, isLoading: appConfigLoading } = useAppConfig()
  const { data: session, isPending: isSessionPending } = authClient.useSession()

  const [fileId, setFileId] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileMimeType, setFileMimeType] = useState("")
  const [fileSize, setFileSize] = useState(0)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("fast")
  const [useLlm, setUseLlm] = useState(true)
  const [forceOcr, setForceOcr] = useState(false)
  const [pageRange, setPageRange] = useState("")
  const [error, setError] = useState("")
  const [pendingAuth, setPendingAuth] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const pendingStateRef = useRef<PendingDocumentState | null | undefined>(
    undefined,
  )
  if (pendingStateRef.current === undefined) {
    pendingStateRef.current = loadPendingState()
  }

  const reset = useCallback(() => {
    setFileId("")
    setFileName("")
    setFileMimeType("")
    setFileSize(0)
    setPageCount(null)
    setUploadProgress(0)
    setUploadComplete(false)
    setProcessingMode("fast")
    setUseLlm(true)
    setForceOcr(false)
    setPageRange("")
    setError("")
    setPendingAuth(false)
    setIsCreating(false)
    clearPendingState()
  }, [])

  const uploadFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setFileMimeType(file.type)
    setFileSize(file.size)
    setUploadProgress(0)
    setUploadComplete(false)
    setError("")

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90))
    }, 200)

    try {
      const data = await AppRuntime.runPromise(apiUploadFile(file))
      setFileId(data.file_id)
      setFileName(data.filename)
      setFileMimeType(data.content_type)
      setFileSize(data.size)
      setPageCount(data.page_count)
      setUploadProgress(100)
      setUploadComplete(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed"
      reset()
      setError(message)
    } finally {
      clearInterval(progressInterval)
    }
  }, [reset])

  const createDocument = useCallback(
    async (options?: { skipAuthCheck?: boolean; params?: PendingDocumentState }) => {
      const params = options?.params ?? {
        fileId,
        fileName,
        fileMimeType,
        fileSize,
        pageCount,
        processingMode,
        useLlm,
        forceOcr,
        pageRange,
        audioVoiceId: readNarratorVoice(),
      }

      if (!options?.skipAuthCheck && appConfigLoading) return

      if (!options?.skipAuthCheck && !user) {
        sessionStorage.setItem(PENDING_DOCUMENT_KEY, JSON.stringify(params))
        setPendingAuth(true)
        return
      }

      setIsCreating(true)
      setError("")

      try {
        const result = await AppRuntime.runPromise(
          createDocumentFromUpload({
            fileId: params.fileId,
            filename: params.fileName,
            mimeType: params.fileMimeType,
            sizeBytes: params.fileSize,
            pageCount: params.pageCount,
            processingMode: params.processingMode,
            useLlm: params.useLlm,
            forceOcr: params.forceOcr,
            pageRange: params.pageRange,
            audioVoiceId: params.audioVoiceId,
          }),
        )
        clearPendingState()
        await navigate({ to: "/$documentId", params: { documentId: result.documentId } })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create document")
      } finally {
        setIsCreating(false)
      }
    },
    [
      fileId,
      fileName,
      fileMimeType,
      fileSize,
      pageCount,
      processingMode,
      useLlm,
      forceOcr,
      pageRange,
      appConfigLoading,
      user,
      navigate,
    ],
  )

  useEffect(() => {
    const saved = pendingStateRef.current
    if (!saved || isSessionPending || session?.user) return

    setFileId(saved.fileId)
    setFileName(saved.fileName)
    setFileMimeType(saved.fileMimeType)
    setFileSize(saved.fileSize)
    setPageCount(saved.pageCount)
    setProcessingMode(saved.processingMode)
    setUseLlm(saved.useLlm)
    setForceOcr(saved.forceOcr)
    setPageRange(saved.pageRange)
    setUploadComplete(true)
    setPendingAuth(true)
    pendingStateRef.current = null
  }, [session, isSessionPending])

  useEffect(() => {
    const saved = pendingStateRef.current
    if (!saved || isSessionPending || !session?.user) return

    pendingStateRef.current = null
    clearPendingState()
    setFileId(saved.fileId)
    setFileName(saved.fileName)
    setFileMimeType(saved.fileMimeType)
    setFileSize(saved.fileSize)
    setPageCount(saved.pageCount)
    setProcessingMode(saved.processingMode)
    setUseLlm(saved.useLlm)
    setForceOcr(saved.forceOcr)
    setPageRange(saved.pageRange)
    setUploadComplete(true)
    void createDocument({ skipAuthCheck: true, params: saved })
  }, [session, isSessionPending, createDocument])

  return {
    hasPendingOAuthResume: pendingStateRef.current != null && isSessionPending,
    pendingAuth,
    setPendingAuth,
    isCreating,
    fileId,
    fileName,
    fileMimeType,
    pageCount,
    uploadProgress,
    uploadComplete,
    processingMode,
    useLlm,
    forceOcr,
    pageRange,
    error,
    uploadFile,
    createDocument,
    reset,
    setProcessingMode,
    setUseLlm,
    setForceOcr,
    setPageRange,
  }
}
