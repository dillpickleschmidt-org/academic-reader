"use client"

import { useState, type ReactNode } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  CollapsibleRoot,
  CollapsiblePanel,
} from "@repo/core/ui/primitives/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@repo/core/ui/primitives/sidebar"

type NavSubItem =
  | {
      title: string
      url: string
      displayPage?: number
      isChild?: boolean
      onClick?: () => void
    }
  | {
      render: ReactNode
    }

type NavItem = {
  title: string
  url: string
  icon?: LucideIcon
  isActive?: boolean
  onClick?: () => boolean | "open" | void // false = no change, "open" = force open
  items?: NavSubItem[]
}

function NavItem({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(item.isActive ?? false)

  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={item.title}
          onClick={() => {
            const result = item.onClick?.()
            if (result === false) return
            if (result === "open") {
              setOpen(true)
              return
            }
            setOpen((o) => !o)
          }}
        >
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
        </SidebarMenuButton>
        <CollapsiblePanel>
          <SidebarMenuSub>
            {item.items?.map((subItem, index) =>
              "render" in subItem ? (
                <SidebarMenuSubItem key={index}>
                  {subItem.render}
                </SidebarMenuSubItem>
              ) : (
                <SidebarMenuSubItem key={`${subItem.title}-${index}`}>
                  <SidebarMenuSubButton
                    render={
                      <a
                        href={subItem.url}
                        onClick={(e) => {
                          if (subItem.onClick) {
                            e.preventDefault()
                            subItem.onClick()
                          }
                        }}
                      />
                    }
                    className={subItem.isChild ? "pl-6" : ""}
                  >
                    <span className="flex-1 truncate">{subItem.title}</span>
                    {subItem.displayPage !== undefined && (
                      <span className="text-muted-foreground text-xs ml-2 shrink-0">
                        {subItem.displayPage}
                      </span>
                    )}
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ),
            )}
          </SidebarMenuSub>
        </CollapsiblePanel>
      </SidebarMenuItem>
    </CollapsibleRoot>
  )
}

export function NavMain({
  items,
  label,
}: {
  items: NavItem[]
  label?: string
}) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => (
          <NavItem key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
