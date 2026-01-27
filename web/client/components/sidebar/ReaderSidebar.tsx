"use client"

import * as React from "react"
import { BookOpen, Bot, Download, Plus } from "lucide-react"

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
} from "@repo/core/ui/primitives/sidebar"
import { useChatPanel } from "@/context/ChatPanelContext"
import type { TocDisplayItem } from "@/hooks/use-table-of-contents"

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

  const threadsData = {
    title: "Chat Threads",
    url: "#",
    icon: Bot,
    isActive: false,
    onClick: () => {
      if (state === "collapsed") {
        setOpen(true)
        chatPanel.open()
        return "open" as const
      }
    },
    items: [{ render: <ChatThreadsNewButton /> }],
  }

  // Flatten TOC items with children for display (children indented)
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
    onClick: () => {
      if (state === "collapsed") {
        setOpen(true)
        return "open" as const
      }
    },
    items: flattenedTocItems.map((item) => ({
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
