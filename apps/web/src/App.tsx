import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id } from "@academic-reader/convex/convex/_generated/dataModel"
import { deleteSavedDocument } from "@academic-reader/api-client/client"
import { AppRuntime } from "@/lib/runtime"
import { useConversion, type Page } from "./hooks/use-conversion"
import { useAppConfig } from "./hooks/use-app-config"

import { DocumentProvider } from "./context/DocumentContext"
import { AudioProvider } from "./context/AudioContext"
import { AuthDialog } from "./components/AuthDialog"
import { DeleteDocumentDialog } from "./components/DeleteDocumentDialog"
import { LandingPage } from "./pages/LandingPage"
import { PricingPage } from "./pages/PricingPage"
import { resultPageImport } from "./utils/preload"

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
)

const ConfigureProcessingPage = lazy(() =>
  import("./pages/ConfigureProcessingPage").then((m) => ({
    default: m.ConfigureProcessingPage,
  })),
)

const ResultPage = lazy(resultPageImport)

const backendMode = import.meta.env.VITE_BACKEND_MODE

function App() {
  const conversion = useConversion()
  const { user } = useAppConfig()
  const prevPageRef = useRef<Page>(conversion.page)
  const [deleteDialog, setDeleteDialog] = useState<{
    documentId: string
    filename: string
  } | null>(null)

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const page = e.state?.page as Page | undefined
      if (page) {
        conversion.setPage(page)
      } else {
        conversion.setPage("landing")
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [conversion.setPage])

  useEffect(() => {
    const prevPage = prevPageRef.current
    prevPageRef.current = conversion.page

    if (prevPage === conversion.page) return

    if (prevPage === "landing" && conversion.page !== "landing") {
      history.pushState({ page: conversion.page }, "")
    } else if (prevPage !== "landing" && conversion.page !== "landing") {
      history.replaceState({ page: conversion.page }, "")
    } else if (conversion.page === "landing") {
      history.replaceState({ page: "landing" }, "")
    }
  }, [conversion.page])

  const recentDocuments = useQuery(
    api.api.documents.listPersisted,
    user ? {} : "skip",
  )

  const handleViewDocument = useCallback(
    (documentId: string) => {
      const doc = recentDocuments?.find((d) => d._id === documentId)
      if (doc) {
        conversion.loadSavedDocument(documentId, doc.filename)
      }
    },
    [recentDocuments, conversion],
  )

  const threadCountQuery = useQuery(
    api.api.chat.countThreadsForDocument,
    deleteDialog
      ? { documentId: deleteDialog.documentId as Id<"documents"> }
      : "skip",
  )

  useEffect(() => {
    if (!deleteDialog || threadCountQuery === undefined) return

    if (threadCountQuery === 0) {
      AppRuntime.runPromise(
        deleteSavedDocument(deleteDialog.documentId, "delete"),
      )
      setDeleteDialog(null)
    }
  }, [deleteDialog, threadCountQuery])

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      const doc = recentDocuments?.find((d) => d._id === documentId)
      if (!doc) return

      setDeleteDialog({
        documentId,
        filename: doc.filename,
      })
    },
    [recentDocuments],
  )

  const executeDelete = useCallback(
    async (threadAction: "keep" | "delete") => {
      if (!deleteDialog) return
      await AppRuntime.runPromise(
        deleteSavedDocument(deleteDialog.documentId, threadAction),
      )
      setDeleteDialog(null)
    },
    [deleteDialog],
  )

  const authDialog = (
    <AuthDialog
      open={conversion.pendingConversion}
      onOpenChange={(open) => {
        if (!open) {
          conversion.setPendingConversion(false)
        }
      }}
      onSuccess={() => {
        conversion.setPendingConversion(false)
        conversion.startConversion({ skipAuthCheck: true })
      }}
      showTrigger={false}
    />
  )

  if (conversion.hasPendingOAuthResume) {
    return <PageLoader />
  }

  if (window.location.pathname === "/pricing") {
    return <PricingPage />
  }

  switch (conversion.page) {
    case "landing":
      return (
        <>
          <LandingPage
            onFileSelect={conversion.uploadFile}
            recentDocuments={recentDocuments}
            onViewDocument={handleViewDocument}
            onDeleteDocument={handleDeleteDocument}
          />
          <DeleteDocumentDialog
            open={deleteDialog !== null && (threadCountQuery ?? 0) > 0}
            onOpenChange={(open) => {
              if (!open) setDeleteDialog(null)
            }}
            filename={deleteDialog?.filename ?? ""}
            threadCount={threadCountQuery ?? 0}
            onKeepThreads={() => executeDelete("keep")}
            onDeleteAll={() => executeDelete("delete")}
          />
        </>
      )

    case "configure":
    case "processing":
      return (
        <>
          {authDialog}
          <Suspense fallback={<PageLoader />}>
            <ConfigureProcessingPage
              fileName={conversion.fileName}
              fileMimeType={conversion.fileMimeType}
              pageCount={conversion.pageCount}
              uploadProgress={conversion.uploadProgress}
              uploadComplete={conversion.uploadComplete}
              backendMode={backendMode}
              processingMode={conversion.processingMode}
              useLlm={conversion.useLlm}
              pageRange={conversion.pageRange}
              error={conversion.error}
              isProcessing={conversion.page === "processing"}
              isCancelling={conversion.isCancelling}
              stages={conversion.stages}
              onProcessingModeChange={conversion.setProcessingMode}
              onUseLlmChange={conversion.setUseLlm}
              onPageRangeChange={conversion.setPageRange}
              onStartConversion={conversion.startConversion}
              onCancel={conversion.cancelConversion}
              onBack={conversion.reset}
            />
          </Suspense>
        </>
      )

    case "result":
      return (
        <DocumentProvider
          documentId={conversion.documentId}
          chunks={conversion.chunks}
          documentName={conversion.fileName}
          toc={conversion.toc}
        >
          <AudioProvider documentId={conversion.documentId}>
            <Suspense fallback={<PageLoader />}>
              <ResultPage
                content={conversion.content}
                imagesReady={conversion.imagesReady}
                onDownload={conversion.downloadResult}
                onReset={conversion.reset}
              />
            </Suspense>
          </AudioProvider>
        </DocumentProvider>
      )

    default: {
      const _exhaustive: never = conversion.page
      throw new Error(`Unhandled page: ${_exhaustive}`)
    }
  }
}

export default App
