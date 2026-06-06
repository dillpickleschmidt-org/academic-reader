import { createContext, useContext, type ReactNode } from "react"
import type { BackendType, ProcessingMode } from "@academic-reader/api-client/schemas/common"

export interface RuntimeConfig {
  convexUrl: string
  conversionBackend: BackendType
  ttsEnabled: boolean
  webSearchEnabled: boolean
  processingModes: ProcessingMode[]
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null)

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig
  children: ReactNode
}) {
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  )
}

export function useRuntimeConfig() {
  const config = useContext(RuntimeConfigContext)
  if (!config) throw new Error("Runtime config provider is missing")
  return config
}
