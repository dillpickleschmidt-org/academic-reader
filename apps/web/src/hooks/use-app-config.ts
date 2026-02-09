import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"

const DEFAULT_AUTH_PROVIDERS = { google: false, email: true } as const

export function useAppConfig() {
  const config = useQuery(api.api.config.getAppConfig)
  return {
    user: config?.user ?? null,
    authProviders: config?.authProviders ?? DEFAULT_AUTH_PROVIDERS,
    isLoading: config === undefined,
  }
}
