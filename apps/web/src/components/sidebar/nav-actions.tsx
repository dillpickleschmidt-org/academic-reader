"use client"

import { type LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/core/ui/primitives/sidebar"

export function NavActions({
  actions,
}: {
  actions: {
    name: string
    icon: LucideIcon
    onClick?: () => void
    disabled?: boolean
    isActive?: boolean
    className?: string
  }[]
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Actions</SidebarGroupLabel>
      <SidebarMenu>
        {actions.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton
              onClick={item.onClick}
              disabled={item.disabled}
              tooltip={item.name}
              data-active={item.isActive}
              className={item.className}
            >
              <item.icon />
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
