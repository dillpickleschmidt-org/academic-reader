import { useEffect, useRef, type ReactNode } from "react"
import { Plus } from "lucide-react"
import { THEMES, type ReaderTheme } from "@/constants/themes"
import { useReaderTheme } from "@/hooks/use-reader-theme"
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarMenuButton,
} from "@repo/core/ui/primitives/sidebar"
import { ReaderSidebar } from "./sidebar/ReaderSidebar"

interface Props {
  children: ReactNode
  onDownload: () => void
  onReset: () => void
  showThemeToggle?: boolean
  showSidebar?: boolean
  downloadDisabled?: boolean
}

export function ReaderLayout({
  children,
  onDownload,
  onReset,
  showThemeToggle = false,
  showSidebar = false,
  downloadDisabled = false,
}: Props) {
  const [theme, setTheme] = useReaderTheme()
  const radioRefs = useRef<Record<ReaderTheme, HTMLInputElement | null>>({
    light: null,
    comfort: null,
    dark: null,
  })

  // Sync radio buttons with theme state
  useEffect(() => {
    const radio = radioRefs.current[theme]
    if (radio && !radio.checked) {
      radio.checked = true
    }
  }, [theme])

  const handleRadioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTheme = e.target.value as ReaderTheme
    setTheme(newTheme)
  }

  return (
    <SidebarProvider defaultOpen={false}>
      {showSidebar && (
        <ReaderSidebar
          onDownload={onDownload}
          downloadDisabled={downloadDisabled}
        />
      )}
      <SidebarInset>
        <header className="flex shrink-0 items-center gap-2 transition-[width,height] ease-linear">
          <div className="flex items-center ml-4 gap-1 my-2">
            {showSidebar && <SidebarTrigger className="-ml-1" />}
            <SidebarMenuButton
              onClick={onReset}
              tooltip="New"
              className="size-8 p-2 [&_svg]:size-4.5"
            >
              <Plus />
            </SidebarMenuButton>
          </div>
        </header>
        {/* Hidden radio inputs - must be siblings before .reader-output for CSS selectors */}
        {THEMES.map((t) => (
          <input
            key={t.id}
            ref={(el) => {
              radioRefs.current[t.id] = el
            }}
            type="radio"
            name="theme"
            id={`theme-${t.id}`}
            value={t.id}
            defaultChecked={t.id === theme}
            onChange={handleRadioChange}
            className="theme-radios"
          />
        ))}
        <div className="reader-output">
          {showThemeToggle && (
            <div className="reader-theme-toggle">
              {THEMES.map((t) => {
                const Icon = t.icon
                return (
                  <label key={t.id} htmlFor={`theme-${t.id}`} title={t.title}>
                    <Icon size={18} />
                  </label>
                )
              })}
            </div>
          )}
          <div className="reader-content">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
