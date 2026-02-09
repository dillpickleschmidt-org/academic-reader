"use client"

import * as React from "react"
import {
  BookOpen,
  Bot,
  Download,
  Link2Off,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavActions } from "@/components/sidebar/nav-actions"
import { ColorThemeSelector } from "@/components/sidebar/ColorThemeSelector"
import { TypographyStyleToggle } from "@/components/sidebar/TypographyStyleToggle"
import { AudioSettingsPopover } from "@/components/sidebar/audio-settings"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuSubButton,
  SidebarRail,
  useSidebar,
} from "@academic-reader/ui/primitives/sidebar"
import { Switch } from "@academic-reader/ui/primitives/switch"
import { useChatPanel } from "@/context/ChatPanelContext"
import type { TocDisplayItem } from "@/hooks/use-table-of-contents"

function ChatThreadsViewToggle() {
  const { viewMode, setViewMode } = useChatPanel()
  return (
    <div className="flex items-center justify-end gap-1.5 ml-2 -mr-2.5 mt-1">
      <span className="text-xs text-muted-foreground">
        {viewMode === "all" ? "All threads" : "This document"}
      </span>
      <Switch
        size="sm"
        checked={viewMode === "all"}
        onCheckedChange={(checked) => setViewMode(checked ? "all" : "document")}
        className="data-checked:bg-sidebar-primary"
      />
    </div>
  )
}

function ChatThreadsNewButton() {
  const { startNewThread } = useChatPanel()
  return (
    <SidebarMenuSubButton
      onClick={startNewThread}
      className="group/new ml-2 -mr-3 h-auto my-0.5 py-1 gap-1 justify-center cursor-pointer bg-muted/30 hover:bg-muted/70 border-2 border-dashed border-border text-foreground/70 hover:text-foreground"
    >
      <Plus className="size-3 -ml-1.5 text-foreground/70! group-hover/new:text-foreground!" />
      <span>New</span>
    </SidebarMenuSubButton>
  )
}

const THREAD_COLORS = [
  "bg-red-400",
  "bg-orange-400",
  "bg-amber-400",
  "bg-yellow-400",
  "bg-lime-400",
  "bg-green-400",
  "bg-emerald-400",
  "bg-cyan-400",
  "bg-sky-400",
  "bg-blue-400",
  "bg-violet-400",
  "bg-pink-400",
]

const ChatThreadItem = React.memo(function ChatThreadItem({
  threadId,
  title,
  isActive,
  isUnlinked,
  colorIndex,
  documentName,
}: {
  threadId: string
  title: string
  isActive: boolean
  isUnlinked: boolean
  colorIndex?: number
  documentName?: string
}) {
  const { selectThread, deleteThread } = useChatPanel()
  return (
    <SidebarMenuSubButton
      onClick={() => selectThread(threadId)}
      title={documentName}
      className={`group/thread relative h-auto my-0.5 py-1 pl-2.75 cursor-pointer overflow-hidden ${isActive ? "bg-muted font-medium" : ""}`}
    >
      {colorIndex !== undefined && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-[2.75%] rounded-tl-sm rounded-bl-sm ${THREAD_COLORS[colorIndex]}`}
        />
      )}
      {isUnlinked && (
        <Link2Off className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="flex-1 truncate">{title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          deleteThread(threadId)
        }}
        className="opacity-0 group-hover/thread:opacity-100 shrink-0 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
      >
        <Trash2 className="size-3" />
      </button>
    </SidebarMenuSubButton>
  )
})

interface ReaderSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onDownload?: () => void
  downloadDisabled?: boolean
  tocItems?: TocDisplayItem[]
}

export function ReaderSidebar({
  onDownload,
  downloadDisabled,
  tocItems,
  ...props
}: ReaderSidebarProps) {
  const { state, setOpen } = useSidebar()
  const chatPanel = useChatPanel()

  const threadItems = React.useMemo(() => {
    const items: Array<{ render: React.ReactNode }> = []

    items.push({ render: <ChatThreadsNewButton /> })
    items.push({ render: <ChatThreadsViewToggle /> })

    if (chatPanel.threads) {
      items.push({
        render: (
          <div className="max-h-[300px] overflow-y-auto">
            {chatPanel.threads.map((thread) => (
              <ChatThreadItem
                key={thread._id}
                threadId={thread._id}
                title={thread.title ?? "New chat"}
                isActive={chatPanel.activeThreadId === thread._id}
                isUnlinked={thread.documentId === undefined}
                colorIndex={thread.documentColor}
                documentName={thread.documentName}
              />
            ))}
          </div>
        ),
      })
    }

    return items
  }, [chatPanel.threads, chatPanel.activeThreadId])

  const threadsData = {
    title: "Chat Threads",
    url: "#",
    icon: Bot,
    isActive: chatPanel.isOpen,
    onClick: () => {
      if (state === "collapsed") {
        setOpen(true)
        chatPanel.open()
      }
    },
    items: threadItems,
  }

  const tocLoading = tocItems === undefined

  const flattenedTocItems = React.useMemo(() => {
    if (!tocItems) return []

    const items: Array<{
      title: string
      url: string
      displayPage?: number
      isChild?: boolean
      onClick: () => void
    }> = []

    for (const item of tocItems) {
      items.push({
        title: item.title,
        url: `#${item.id}`,
        displayPage: item.displayPage,
        onClick: () => {
          const el = document.getElementById(item.id)
          if (el) {
            el.scrollIntoView({ behavior: "smooth" })
          }
        },
      })

      if (item.children) {
        for (const child of item.children) {
          items.push({
            title: child.title,
            url: `#${child.id}`,
            displayPage: child.displayPage,
            isChild: true,
            onClick: () => {
              const el = document.getElementById(child.id)
              if (el) {
                el.scrollIntoView({ behavior: "smooth" })
              }
            },
          })
        }
      }
    }

    return items
  }, [tocItems])

  const tocData = {
    title: "Table of Contents",
    url: "#",
    icon: BookOpen,
    isActive: true,
    className:
      "max-h-[400px] overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-40px),transparent)]",
    onClick: () => {
      if (state === "collapsed") {
        setOpen(true)
      }
    },
    items: tocLoading
      ? [
          {
            render: (
              <div className="flex items-center gap-2 px-2 py-3 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="text-xs">Extracting...</span>
              </div>
            ),
          },
        ]
      : flattenedTocItems.map((item) => ({
          title: item.title,
          url: item.url,
          displayPage: item.displayPage,
          isChild: item.isChild,
          onClick: item.onClick,
        })),
  }

  const actions = [
    {
      render: <AudioSettingsPopover />,
    },
    {
      render: <TypographyStyleToggle />,
    },
    {
      name: "Download",
      icon: Download,
      onClick: onDownload,
      disabled: downloadDisabled,
    },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {/* Empty for now - could add document title later */}
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={[tocData, threadsData]} />
        <NavActions actions={actions} />
      </SidebarContent>
      <SidebarFooter>
        <ColorThemeSelector />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
