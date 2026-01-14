import { Palette, Check, ChevronsUpDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/core/ui/primitives/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@repo/core/ui/primitives/sidebar"
import { COLOR_THEMES } from "@/constants/color-themes"
import { useColorTheme } from "@/hooks/use-color-theme"

export function ColorThemeSelector() {
  const [theme, setTheme] = useColorTheme()
  const currentTheme = COLOR_THEMES.find((t) => t.id === theme)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="w-full focus:ring-2 focus:ring-sidebar-ring rounded-md"
            render={(props) => (
              <SidebarMenuButton
                {...props}
                size="lg"
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Palette className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Theme</span>
                  <span className="truncate text-xs">{currentTheme?.name}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            )}
          />
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side="top"
            align="start"
            sideOffset={4}
          >
            {COLOR_THEMES.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => setTheme(t.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Palette className="size-4 shrink-0" />
                </div>
                {t.name}
                {theme === t.id && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
