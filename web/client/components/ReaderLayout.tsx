import { type ReactNode, useRef } from "react"
import { Plus } from "lucide-react"
import { THEMES } from "@/constants/themes"
import { useReaderTheme } from "@/hooks/use-reader-theme"
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarMenuButton,
} from "@repo/core/ui/primitives/sidebar"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@repo/core/ui/primitives/resizable"
import { ReaderSidebar } from "./sidebar/ReaderSidebar"
import { AIChatPanel } from "./AIChatPanel"
import { TTSPlaybackBar } from "./TTSPlaybackBar"
import { ChatPanelProvider, useChatPanel } from "@/context/ChatPanelContext"
import { useTableOfContents } from "@/hooks/use-table-of-contents"
import { useScrollDirection } from "@/hooks/use-scroll-direction"
import { useDocumentContext } from "@/context/DocumentContext"

interface Props {
  children: ReactNode
  onDownload: () => void
  onReset: () => void
  showThemeToggle?: boolean
  showSidebar?: boolean
  downloadDisabled?: boolean
}

function ReaderLayoutInner({
  children,
  onDownload,
  onReset,
  showThemeToggle = false,
  showSidebar = false,
  downloadDisabled = false,
}: Props) {
  const [readerMode, setReaderMode] = useReaderTheme()
  const { isOpen, close } = useChatPanel()
  const tocItems = useTableOfContents()
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollDirection(scrollRef)
  const documentContext = useDocumentContext()
  const documentName = documentContext?.documentName?.replace(/\.[^.]+$/, "")

  return (
    <SidebarProvider defaultOpen={false}>
      {showSidebar && (
        <ReaderSidebar
          onDownload={onDownload}
          downloadDisabled={downloadDisabled}
          tocItems={tocItems}
        />
      )}
      <SidebarInset className="h-svh overflow-hidden">
        <div className="reader-output flex flex-col" data-reader-mode={readerMode}>
          {showThemeToggle && (
            <div className="reader-theme-toggle">
              {THEMES.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.title}
                    data-active={readerMode === t.id}
                    onClick={() => setReaderMode(t.id)}
                  >
                    <Icon size={18} />
                  </button>
                )
              })}
            </div>
          )}
          <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
            <ResizablePanel id="content-panel" minSize="40%">
              <div ref={scrollRef} className="overflow-auto h-full">
                {/* Sticky action buttons - top left */}
                {showSidebar && (
                  <div className="reader-actions-left sticky top-2 ml-4 mt-2 -mb-10 flex items-center gap-1 z-10 w-fit bg-[var(--reader-bg)] p-1 rounded-lg">
                    <SidebarTrigger className="-ml-1" />
                    <SidebarMenuButton
                      onClick={onReset}
                      tooltip="New"
                      className="size-8 p-2 [&_svg]:size-4.5"
                    >
                      <Plus />
                    </SidebarMenuButton>
                    {documentName && (
                      <>
                        <div className="w-px h-5 bg-[var(--reader-border)] mx-1.5 lg:mx-2" />
                        <span className="text-sm text-[var(--reader-text-muted)] whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]">
                          {documentName}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div className="reader-content">{children}</div>
              </div>
            </ResizablePanel>
            {isOpen && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="chat-panel"
                  defaultSize="30%"
                  minSize="20%"
                  maxSize="50%"
                >
                  <AIChatPanel onClose={close} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
          <TTSPlaybackBar />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function ReaderLayout(props: Props) {
  return (
    <ChatPanelProvider>
      <ReaderLayoutInner {...props} />
    </ChatPanelProvider>
  )
}
