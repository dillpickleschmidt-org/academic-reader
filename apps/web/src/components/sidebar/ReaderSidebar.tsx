"use client"

import * as React from "react"
import {
  BookOpen,
  Bot,
  Download,
  Volume2,
} from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavActions } from "@/components/sidebar/nav-actions"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@repo/core/ui/primitives/sidebar"

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

const threadsData = {
  title: "Chat Threads",
  url: "#",
  icon: Bot,
  isActive: false,
  items: [
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
  const actions = [
    {
      name: "Text to Speech",
      icon: Volume2,
      disabled: true, // Placeholder - not implemented yet
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
        {/* Empty for now - could add user info later */}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
