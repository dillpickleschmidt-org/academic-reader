import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useQuery } from "convex/react"
import { toast } from "sonner"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type { Id, Doc } from "@academic-reader/convex/convex/_generated/dataModel"
import { deleteDocument, downloadFile, loadDocumentContent } from "@academic-reader/api-client/client"
import type { LoadedDocument } from "@academic-reader/api-client/schemas/document"
import { AppRuntime } from "@/lib/runtime"
import { resolveDownloadSettings } from "@/settings/download"
import { DocumentProvider } from "@/context/DocumentContext"
import { AudioDocumentBinding } from "@/context/AudioContext"
import { useAppConfig } from "@/hooks/use-app-config"
import { useDocumentCreation } from "@/hooks/use-document-creation"
import { useNarratorVoicePreference } from "@/audio/narrator-preference"
import { useRuntimeConfig } from "@/context/RuntimeConfigContext"
import {
  SidebarInset,
  SidebarProvider,
} from "@academic-reader/ui/primitives/sidebar"
import { AuthDialog } from "@/components/AuthDialog"
import { DeleteDocumentDialog } from "@/components/DeleteDocumentDialog"
import { LandingPage } from "@/pages/LandingPage"
import { PricingPage } from "@/pages/PricingPage"
import { ConfigureProcessingPage } from "@/pages/ConfigureProcessingPage"
import { ChatPanelProvider } from "@/context/ChatPanelContext"
import { ReaderSidebar } from "@/components/sidebar/ReaderSidebar"
import { TTSPlaybackBar } from "@/components/TTSPlaybackBar"

const ResultPage = lazy(() =>
  import("@/pages/ResultPage").then((m) => ({ default: m.ResultPage })),
)

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
)

const rootRoute = createRootRoute({
  component: RootRoute,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
})

const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pricing",
  component: PricingRoute,
})

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$documentId",
  component: DocumentRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, pricingRoute, documentRoute])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

function RootRoute() {
  return <Outlet />
}

function PricingRoute() {
  return <PricingPage />
}

function HomeRoute() {
  const runtimeConfig = useRuntimeConfig()
  const navigate = useNavigate()
  const { user } = useAppConfig()
  const flow = useDocumentCreation()
  const [narratorVoice, setNarratorVoice] = useNarratorVoicePreference()
  const [deleteDialog, setDeleteDialog] = useState<{
    documentId: string
    filename: string
  } | null>(null)

  const documents = useQuery(api.api.documents.list, user ? {} : "skip")
  const threadCountQuery = useQuery(
    api.api.chat.countThreadsForDocument,
    deleteDialog
      ? { documentId: deleteDialog.documentId as Id<"documents"> }
      : "skip",
  )

  useEffect(() => {
    if (!deleteDialog || threadCountQuery === undefined) return

    if (threadCountQuery === 0) {
      AppRuntime.runPromise(deleteDocument(deleteDialog.documentId, "delete"))
      setDeleteDialog(null)
    }
  }, [deleteDialog, threadCountQuery])

  const handleViewDocument = useCallback(
    (documentId: string) => {
      void navigate({ to: "/$documentId", params: { documentId } })
    },
    [navigate],
  )

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      const doc = documents?.find((d) => d._id === documentId)
      if (!doc) return
      setDeleteDialog({ documentId, filename: doc.filename })
    },
    [documents],
  )

  const executeDelete = useCallback(
    async (threadAction: "keep" | "delete") => {
      if (!deleteDialog) return
      await AppRuntime.runPromise(
        deleteDocument(deleteDialog.documentId, threadAction),
      )
      setDeleteDialog(null)
    },
    [deleteDialog],
  )

  if (flow.hasPendingOAuthResume) return <PageLoader />

  const authDialog = (
    <AuthDialog
      open={flow.pendingAuth}
      onOpenChange={(open) => {
        if (!open) flow.setPendingAuth(false)
      }}
      onSuccess={() => {
        flow.setPendingAuth(false)
        void flow.createDocument({ skipAuthCheck: true })
      }}
      showTrigger={false}
    />
  )

  if (flow.fileName || flow.uploadProgress > 0) {
    return (
      <>
        {authDialog}
        <ConfigureProcessingPage
          fileName={flow.fileName}
          fileMimeType={flow.fileMimeType}
          pageCount={flow.pageCount}
          uploadProgress={flow.uploadProgress}
          uploadComplete={flow.uploadComplete}
          conversionBackend={runtimeConfig.conversionBackend}
          processingModes={runtimeConfig.processingModes}
          ttsEnabled={runtimeConfig.ttsEnabled}
          processingMode={flow.processingMode}
          useLlm={flow.useLlm}
          forceOcr={flow.forceOcr}
          pageRange={flow.pageRange}
          narratorVoice={narratorVoice}
          error={flow.error}
          isProcessing={flow.isCreating}
          onProcessingModeChange={flow.setProcessingMode}
          onUseLlmChange={flow.setUseLlm}
          onForceOcrChange={flow.setForceOcr}
          onPageRangeChange={flow.setPageRange}
          onNarratorVoiceChange={setNarratorVoice}
          onStartConversion={() => void flow.createDocument()}
          onBack={flow.reset}
        />
      </>
    )
  }

  const landing = (
    <>
      <LandingPage
        onFileSelect={flow.uploadFile}
        recentDocuments={documents}
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

  if (!user) return landing

  return (
    <ChatPanelProvider>
      <SidebarProvider defaultOpen={false}>
        <ReaderSidebar tocItems={[]} downloadDisabled />
        <SidebarInset className="min-h-svh">
          {landing}
          <div
            style={
              {
                "--reader-border": "var(--border)",
                "--reader-accent": "var(--primary)",
                "--reader-text": "var(--foreground)",
                "--reader-text-muted": "var(--muted-foreground)",
              } as CSSProperties
            }
          >
            <TTSPlaybackBar />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ChatPanelProvider>
  )
}

function DocumentRoute() {
  const navigate = useNavigate()
  const { documentId } = documentRoute.useParams()
  const { user, isLoading: appConfigLoading } = useAppConfig()
  const { ttsEnabled } = useRuntimeConfig()
  const [authOpen, setAuthOpen] = useState(false)
  const [content, setContent] = useState<LoadedDocument | null>(null)
  const [contentError, setContentError] = useState("")

  useEffect(() => {
    setContent(null)
    setContentError("")
  }, [documentId])

  const typedId = documentId as Id<"documents">
  const document = useQuery(
    api.api.documents.get,
    user ? { documentId: typedId } : "skip",
  )
  const tasks = useQuery(
    api.api.documentTasks.listForDocument,
    user ? { documentId: typedId } : "skip",
  )
  const conversionTask = useMemo(
    () => tasks?.find((task) => task.kind === "conversion"),
    [tasks],
  )
  const conversionSucceeded = conversionTask?.status === "succeeded"
  const conversionFailed = conversionTask?.status === "failed"

  useOptionalTaskToasts(tasks)

  useEffect(() => {
    if (!conversionSucceeded || content) return
    let cancelled = false
    AppRuntime.runPromise(loadDocumentContent(documentId))
      .then((loaded) => {
        if (!cancelled) setContent(loaded)
      })
      .catch((error) => {
        if (!cancelled) {
          setContentError(
            error instanceof Error ? error.message : "Failed to load document",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [conversionSucceeded, content, documentId])

  const audioReadiness = useQuery(
    api.api.ttsAudio.getDocumentAudioReadiness,
    user && ttsEnabled && conversionSucceeded
      ? { documentId: typedId }
      : "skip",
  )

  const handleDownload = useCallback(() => {
    if (!document) return
    void downloadFile(documentId, document.filename, resolveDownloadSettings())
  }, [document, documentId])

  const handleReset = useCallback(() => {
    void navigate({ to: "/" })
  }, [navigate])

  if (appConfigLoading) return <PageLoader />

  if (!user) {
    return (
      <DocumentStatusShell documentName="Academic Reader" onNew={handleReset}>
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold text-foreground">
            Sign in to open this document
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Documents are private to each account.
          </p>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Sign in
          </button>
          <AuthDialog
            open={authOpen}
            onOpenChange={setAuthOpen}
            showTrigger={false}
          />
        </div>
      </DocumentStatusShell>
    )
  }

  if (document === undefined || tasks === undefined) return <PageLoader />

  if (conversionFailed) {
    return (
      <DocumentStatusShell documentName={document.filename} onNew={handleReset}>
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-semibold text-foreground">
            Conversion failed
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {conversionTask?.error ?? "The document could not be converted."}
          </p>
        </div>
      </DocumentStatusShell>
    )
  }

  if (!conversionSucceeded) {
    return (
      <DocumentStatusShell documentName={document.filename} onNew={handleReset}>
        <TaskProgress tasks={tasks} />
      </DocumentStatusShell>
    )
  }

  if (contentError) {
    return (
      <DocumentStatusShell documentName={document.filename} onNew={handleReset}>
        <p className="text-sm text-destructive">{contentError}</p>
      </DocumentStatusShell>
    )
  }

  if (!content) return <PageLoader />

  return (
    <DocumentProvider
      documentId={documentId}
      documentName={document.filename}
      chunks={[...content.chunks]}
      toc={content.toc}
      summary={document.summary}
      audioReadiness={audioReadiness}
      initialAudioVoiceId={conversionTask?.conversion?.audioVoiceId ?? null}
    >
      <AudioDocumentBinding
        documentId={documentId}
        chunks={[...content.chunks]}
        audioReadiness={audioReadiness}
      />
      <Suspense fallback={<PageLoader />}>
        <ResultPage
          content={content.html}
          imagesReady
          onDownload={handleDownload}
          onReset={handleReset}
        />
      </Suspense>
    </DocumentProvider>
  )
}

function DocumentStatusShell({
  documentName,
  onNew,
  children,
}: {
  documentName: string
  onNew: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <div className="font-medium truncate">{documentName}</div>
        <button
          type="button"
          onClick={onNew}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          New
        </button>
      </header>
      <main className="flex-1 flex items-center justify-center p-8">
        {children}
      </main>
    </div>
  )
}

function TaskProgress({ tasks }: { tasks: Doc<"documentTasks">[] }) {
  const activeTasks = tasks.filter(
    (task) => task.status === "pending" || task.status === "running",
  )

  if (!activeTasks.length) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Starting...
      </div>
    )
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-6">
      <h1 className="text-xl font-semibold">Preparing document</h1>
      <div className="mt-4 flex flex-col gap-3">
        {activeTasks.map((task) => (
          <div key={task._id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>{taskLabel(task.kind, task.progress?.label)}</span>
            </div>
            {task.progress && task.progress.total > 0 && (
              <div className="ml-6 flex items-center gap-3">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${Math.round((task.progress.current / task.progress.total) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {task.progress.current}/{task.progress.total}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function useOptionalTaskToasts(tasks: Doc<"documentTasks">[] | undefined) {
  const seenFailures = useRef(new Set<string>())

  useEffect(() => {
    if (!tasks) return
    for (const task of tasks) {
      if (task.kind === "conversion" || task.status !== "failed") continue
      if (seenFailures.current.has(task._id)) continue
      seenFailures.current.add(task._id)
      toast.error(`${taskLabel(task.kind)} failed`, {
        description: task.error ?? undefined,
      })
    }
  }, [tasks])
}

function taskLabel(kind: Doc<"documentTasks">["kind"], progressLabel?: string) {
  if (progressLabel) return progressLabel
  switch (kind) {
    case "conversion":
      return "Converting document"
    case "toc":
      return "Extracting table of contents"
    case "summary":
      return "Generating summary"
    case "tts-prep":
      return "Preparing narration"
    case "tts-audio":
      return "Generating audio"
  }
}
