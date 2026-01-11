import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { convex } from "@repo/convex/client"
import { authClient, ConvexBetterAuthProvider } from "@repo/convex/auth-client"
import { Toaster } from "@repo/core/ui/primitives/sonner"
import "./styles/App.css"
import App from "./App.tsx"

const rootEl = document.getElementById("root")
if (!rootEl) {
  console.error("Root element not found")
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <App />
        <Toaster />
      </ConvexBetterAuthProvider>
    </StrictMode>,
  )
}
