/**
 * Shared Convex HTTP client for server-side mutations/queries.
 */
import { ConvexHttpClient } from "convex/browser"

function getConvexUrl(): string {
  const url = process.env.CONVEX_SITE_URL
  if (!url) {
    // Default to local dev
    return "http://localhost:3210"
  }
  return url
}

export const convex = new ConvexHttpClient(getConvexUrl())
