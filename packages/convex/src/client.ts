import { ConvexReactClient } from "convex/react"

export function createConvexClient(convexUrl: string) {
  if (!convexUrl || typeof convexUrl !== "string") {
    throw new Error("Missing Convex URL")
  }

  return new ConvexReactClient(convexUrl)
}
