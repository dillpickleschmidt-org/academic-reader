import { useState } from "react"
import { Settings2 } from "lucide-react"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@academic-reader/ui/primitives/dialog"
import { Switch } from "@academic-reader/ui/primitives/switch"
import { Checkbox } from "@academic-reader/ui/primitives/checkbox"
import { SidebarMenuButton } from "@academic-reader/ui/primitives/sidebar"
import { useTabIndent } from "@/hooks/use-tab-indent"
import { SETTINGS } from "@/settings/registry"

function useLocalStorage(key: string, defaultValue: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? defaultValue
    } catch {
      return defaultValue
    }
  })

  function set(v: string) {
    setValue(v)
    try {
      localStorage.setItem(key, v)
    } catch {}
  }

  return [value, set] as const
}

function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {children}
    </div>
  )
}

export function SettingsDialog() {
  const [tabIndent, setTabIndent] = useTabIndent()
  const [useWebSettings, setUseWebSettings] = useLocalStorage(
    "download-use-web-settings",
    "on",
  )
  const [downloadTabIndent, setDownloadTabIndent] = useLocalStorage(
    `download-${SETTINGS.tabIndent.key}`,
    SETTINGS.tabIndent.defaultValue,
  )

  return (
    <Dialog>
      <DialogTrigger
        render={(props) => (
          <SidebarMenuButton {...props} tooltip="Settings">
            <Settings2 />
            <span>Settings</span>
          </SidebarMenuButton>
        )}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <SettingsSection title="Reading">
            <SettingsRow
              label={SETTINGS.tabIndent.label}
              description={SETTINGS.tabIndent.description}
            >
              <Switch
                checked={tabIndent === "on"}
                onCheckedChange={(v) => setTabIndent(v ? "on" : "off")}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Download">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={useWebSettings === "on"}
                onCheckedChange={(v) =>
                  setUseWebSettings(v ? "on" : "off")
                }
              />
              <span className="text-sm">Use web settings</span>
            </label>

            {useWebSettings !== "on" && (
              <SettingsRow
                label={SETTINGS.tabIndent.label}
                description={SETTINGS.tabIndent.description}
              >
                <Switch
                  checked={downloadTabIndent === "on"}
                  onCheckedChange={(v) =>
                    setDownloadTabIndent(v ? "on" : "off")
                  }
                />
              </SettingsRow>
            )}
          </SettingsSection>
        </div>
      </DialogContent>
    </Dialog>
  )
}
