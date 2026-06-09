import { useQuery } from "convex/react"
import { api } from "@academic-reader/convex/convex/_generated/api"

export function useAppConfig() {
  const config = useQuery(api.api.config.getAppConfig)
  if (config === undefined) {
    return {
      user: undefined,
      authProviders: undefined,
      isLoading: true,
    } as const
  }

  return {
    user: config.user,
    authProviders: config.authProviders,
    isLoading: false,
  } as const
}
