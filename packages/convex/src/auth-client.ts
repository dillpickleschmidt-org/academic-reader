import { createAuthClient } from "better-auth/react"
import { convexClient } from "@convex-dev/better-auth/client/plugins"

export { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [convexClient()],
})
