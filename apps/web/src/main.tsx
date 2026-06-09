import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { createConvexClient } from "@academic-reader/convex/client"
import {
  authClient,
  ConvexBetterAuthProvider,
} from "@academic-reader/convex/auth-client"
import { Toaster } from "@academic-reader/ui/primitives/sonner"
import { RuntimeConfigProvider, type RuntimeConfig } from "./context/RuntimeConfigContext"
import { AudioProvider } from "./context/AudioContext"
import { router } from "./router"
import "./styles/App.css"

const rootEl = document.getElementById("root")

if (!rootEl) {
  console.error("Root element not found")
} else {
  void bootstrap(rootEl)
}

async function bootstrap(rootEl: HTMLElement) {
  const root = createRoot(rootEl)

  try {
    const config = await loadRuntimeConfig()
    const convex = createConvexClient(config.convexUrl)

    root.render(
      <StrictMode>
        <RuntimeConfigProvider config={config}>
          <ConvexBetterAuthProvider client={convex} authClient={authClient}>
            <AudioProvider>
              <RouterProvider router={router} />
            </AudioProvider>
            <Toaster />
          </ConvexBetterAuthProvider>
        </RuntimeConfigProvider>
      </StrictMode>,
    )
  } catch (error) {
    console.error("Failed to load runtime config", error)
    root.render(
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        Failed to load app configuration.
      </div>,
    )
  }
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/api/runtime-config")
  if (!response.ok) {
    throw new Error(`Runtime config failed: ${response.status}`)
  }
  return (await response.json()) as RuntimeConfig
}
