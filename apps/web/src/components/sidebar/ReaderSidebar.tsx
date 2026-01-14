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
  SidebarMenuSubButton,
  SidebarRail,
} from "@repo/core/ui/primitives/sidebar"
import { useChatPanel } from "@/context/ChatPanelContext"
import { useTTS } from "@/context/TTSContext"

// Mock data - will be replaced with real data later
const tocData = {
  title: "Table of Contents",
  url: "#",
  icon: BookOpen,
  isActive: true,
  items: [
    { title: "Introduction", url: "#" },
    { title: "Methods", url: "#" },
    { title: "Results", url: "#" },
    { title: "Discussion", url: "#" },
  ],
}

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
}

export function ReaderSidebar({
  onDownload,
  downloadDisabled,
  ...props
}: ReaderSidebarProps) {
  const { isEnabled, enable, disable } = useTTS()

  const actions = [
    {
      name: "Text to Speech",
      icon: Volume2,
      onClick: isEnabled ? disable : enable,
      disabled: false,
      isActive: isEnabled,
      className: "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
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
