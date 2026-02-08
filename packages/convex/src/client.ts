import { ConvexReactClient } from "convex/react"

const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl || typeof convexUrl !== "string") {
  throw new Error("Missing required environment variable: VITE_CONVEX_URL")
}

export const convex = new ConvexReactClient(convexUrl)
