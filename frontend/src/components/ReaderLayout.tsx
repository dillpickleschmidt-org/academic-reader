import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { Download, Plus, Sun, BookOpen, Moon } from "lucide-react"
import { useReaderTheme, type ReaderTheme } from "../hooks/useReaderTheme"

const THEMES: { id: ReaderTheme; icon: ReactNode; title: string }[] = [
  { id: "light", icon: <Sun size={18} />, title: "Light" },
  { id: "comfort", icon: <BookOpen size={18} />, title: "Comfort" },
  { id: "dark", icon: <Moon size={18} />, title: "Dark" },
]

interface Props {
  children: ReactNode
  onDownload: () => void
  onReset: () => void
  showThemeToggle?: boolean
  downloadDisabled?: boolean
}

export function ReaderLayout({
  children,
  onDownload,
  onReset,
  showThemeToggle = false,
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
    <>
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
            {THEMES.map((t) => (
              <label key={t.id} htmlFor={`theme-${t.id}`} title={t.title}>
                {t.icon}
              </label>
            ))}
          </div>
        )}
        <div className="reader-actions">
          <button
            onClick={onDownload}
            title={downloadDisabled ? "Waiting for images..." : "Download"}
            disabled={downloadDisabled}
            style={{ opacity: downloadDisabled ? 0.5 : 1 }}
          >
            <Download size={18} />
          </button>
          <button onClick={onReset} title="New">
            <Plus size={18} />
          </button>
        </div>
        <div className="reader-content">{children}</div>
      </div>
    </>
  )
}
