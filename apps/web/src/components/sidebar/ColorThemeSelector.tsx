import { Palette, Check, ChevronsUpDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@academic-reader/ui/primitives/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@academic-reader/ui/primitives/sidebar"
import { COLOR_THEMES } from "@/constants/color-themes"
import { THEMES, type ReaderTheme } from "@/constants/themes"
import { useColorTheme } from "@/hooks/use-color-theme"

interface ColorThemeMenuContentProps {
  readerMode: ReaderTheme
  onReaderModeChange: (mode: ReaderTheme) => void
}

interface ColorThemeSelectorProps extends ColorThemeMenuContentProps {}

export function ColorThemeSelector({
  readerMode,
  onReaderModeChange,
}: ColorThemeSelectorProps) {
  const [theme] = useColorTheme()
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
            <ColorThemeMenuContent
              readerMode={readerMode}
              onReaderModeChange={onReaderModeChange}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function ColorThemeMenuContent({
  readerMode,
  onReaderModeChange,
}: ColorThemeMenuContentProps) {
  const [theme, setTheme] = useColorTheme()

  return (
    <>
      <DropdownMenuGroup>
        <div className="grid grid-cols-3 gap-1">
          {THEMES.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                title={t.title}
                aria-label={t.title}
                data-active={readerMode === t.id}
                onClick={() => onReaderModeChange(t.id)}
                className="flex h-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
              >
                <Icon className="size-4 shrink-0" />
              </button>
            )
          })}
        </div>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
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
      </DropdownMenuGroup>
    </>
  )
}
