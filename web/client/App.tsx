import { lazy, Suspense, useCallback, useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import { useQuery } from "convex/react"
import { api } from "@repo/convex/convex/_generated/api"
import { useConversion, type Page } from "./hooks/use-conversion"
import { useAppConfig } from "./hooks/use-app-config"
import { useColorAnimation } from "./hooks/use-color-animation"
import { DocumentProvider } from "./context/DocumentContext"
import { AudioProvider } from "./context/AudioContext"
import { LandingPage } from "./pages/LandingPage"
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

  // Initialize color cycling animation
  useColorAnimation()

  // History API for back button support
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const page = e.state?.page as Page | undefined
      if (page) {
        conversion.setPage(page)
      } else {
        // No state = landing page
        conversion.setPage("landing")
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [conversion])

  // Push history state when page changes (but not on popstate)
  useEffect(() => {
    const prevPage = prevPageRef.current
    prevPageRef.current = conversion.page

    // Don't push if we're at the same page
    if (prevPage === conversion.page) return

    // Push state when leaving landing for app (enables back button)
    if (prevPage === "landing" && conversion.page !== "landing") {
      history.pushState({ page: conversion.page }, "")
    }
    // Replace state for internal app navigation (configure/processing/result)
    else if (prevPage !== "landing" && conversion.page !== "landing") {
      history.replaceState({ page: conversion.page }, "")
    }
    // Going back to landing
    else if (conversion.page === "landing") {
      history.replaceState({ page: "landing" }, "")
    }
  }, [conversion.page])

  const recentDocuments = useQuery(
    api.api.documents.listPersisted,
    user ? { limit: 2 } : "skip",
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

  const handleDeleteDocument = useCallback(async (documentId: string) => {
    await fetch(`/api/saved-documents/${documentId}`, { method: "DELETE" })
  }, [])

  switch (conversion.page) {
    case "landing":
      return (
        <LandingPage
          onFileSelect={conversion.uploadFile}
          recentDocuments={recentDocuments}
          onViewDocument={handleViewDocument}
          onDeleteDocument={handleDeleteDocument}
        />
      )

    case "configure":
    case "processing":
      return (
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
