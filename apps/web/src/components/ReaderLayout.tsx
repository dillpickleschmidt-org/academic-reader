import { type ReactNode } from "react"
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
import { ChatPanelProvider, useChatPanel } from "@/context/ChatPanelContext"

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

  return (
    <SidebarProvider defaultOpen={false}>
      {showSidebar && (
        <ReaderSidebar
          onDownload={onDownload}
          downloadDisabled={downloadDisabled}
        />
      )}
      <SidebarInset className="h-svh overflow-hidden">
        <div className="reader-output" data-reader-mode={readerMode}>
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
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="content-panel" minSize="40%">
              <div className="overflow-auto h-full">
                {/* Header inside left panel only */}
                <header className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center ml-4 gap-1 my-2">
                    {showSidebar && <SidebarTrigger className="-ml-1" />}
                    <SidebarMenuButton
                      onClick={onReset}
                      tooltip="New"
                      className="size-8 p-2 [&_svg]:size-4.5"
                    >
                      <Plus />
                    </SidebarMenuButton>
                  </div>
                </header>
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
