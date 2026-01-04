import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

export function useAppConfig() {
  const config = useQuery(api.api.config.getAppConfig)
  return {
    user: config?.user ?? null,
    authProviders: config?.authProviders ?? { google: false, email: true },
    isLoading: config === undefined,
  }
}
