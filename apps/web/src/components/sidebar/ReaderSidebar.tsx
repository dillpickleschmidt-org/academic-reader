"use client"

import * as React from "react"
import { BookOpen, Bot, Download, Plus, Volume2 } from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavActions } from "@/components/sidebar/nav-actions"
import { ColorThemeSelector } from "@/components/sidebar/ColorThemeSelector"
import { TypographyStyleToggle } from "@/components/sidebar/TypographyStyleToggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarRail,
  useSidebar,
} from "@repo/core/ui/primitives/sidebar"
import { useChatPanel } from "@/context/ChatPanelContext"
import { useTTSSelector, useTTSActions } from "@/context/TTSContext"

function ChatThreadsNewButton() {
  const { open } = useChatPanel()
  return (
    <SidebarMenuSubButton
      onClick={open}
      className="group/new ml-2 -mr-3 h-auto my-0.5 py-1 gap-1 justify-center cursor-pointer bg-muted/30 hover:bg-muted/70 border-2 border-dashed border-border text-foreground/70 hover:text-foreground"
    >
      <Plus className="size-3 -ml-1.5 text-foreground/70! group-hover/new:text-foreground!" />
      <span>New</span>
    </SidebarMenuSubButton>
  )
}

function TTSToggleButton() {
  const isEnabled = useTTSSelector((s) => s.isEnabled)
  const { enable, disable } = useTTSActions()
  return (
    <SidebarMenuButton
      onClick={isEnabled ? disable : enable}
      tooltip="Text to Speech"
      data-active={isEnabled}
      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
    >
      <Volume2 />
      <span>Text to Speech</span>
    </SidebarMenuButton>
  )
}

const threadsData = {
  title: "Chat Threads",
  url: "#",
  icon: Bot,
  isActive: false,
  items: [
    {
      render: <ChatThreadsNewButton />,
    },
    { title: "Summary", url: "#" },
    { title: "Key findings", url: "#" },
  ],
}

interface ReaderSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onDownload?: () => void
  downloadDisabled?: boolean
  tocItems?: { id: string; title: string }[]
}

export function ReaderSidebar({
  onDownload,
  downloadDisabled,
  tocItems,
  ...props
}: ReaderSidebarProps) {
  const { state, setOpen } = useSidebar()

  const tocData = {
    title: "Table of Contents",
    url: "#",
    icon: BookOpen,
    isActive: true,
    onClick: () => {
      if (state === "collapsed") {
        setOpen(true)
        return false // Prevent collapsible toggle
      }
    },
    items:
      tocItems?.map((item) => ({
        title: item.title,
        url: `#${item.id}`,
        onClick: () => {
          const el = document.getElementById(item.id)
          if (el) {
            el.scrollIntoView({ behavior: "smooth" })
          }
        },
      })) ?? [],
  }

  const actions = [
    {
      render: <TTSToggleButton />,
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
