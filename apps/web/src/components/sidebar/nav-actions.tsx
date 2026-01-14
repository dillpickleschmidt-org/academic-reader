"use client"

import type { ReactNode } from "react"
import { type LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/core/ui/primitives/sidebar"

type ActionItem =
  | {
      name: string
      icon: LucideIcon
      onClick?: () => void
      disabled?: boolean
      isActive?: boolean
      className?: string
      render?: never
    }
  | {
      render: ReactNode
      name?: never
      icon?: never
      onClick?: never
      disabled?: never
      isActive?: never
      className?: never
    }

export function NavActions({ actions }: { actions: ActionItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Actions</SidebarGroupLabel>
      <SidebarMenu>
        {actions.map((item, index) => {
          if ("render" in item && item.render) {
            return <SidebarMenuItem key={index}>{item.render}</SidebarMenuItem>
          }
          const Icon = item.icon!
          return (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton
                onClick={item.onClick}
                disabled={item.disabled}
                tooltip={item.name}
                data-active={item.isActive}
                className={item.className}
              >
                <Icon />
                <span>{item.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
