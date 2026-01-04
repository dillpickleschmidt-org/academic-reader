import { betterAuth } from "better-auth"
import { createClient } from "@convex-dev/better-auth"
import { crossDomain, convex } from "@convex-dev/better-auth/plugins"
import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import type { GenericCtx } from "@convex-dev/better-auth"
import authConfig from "./auth.config"

// SITE_URL for frontend origin (set via `convex env set` for production)
const siteUrl = process.env.SITE_URL?.trim() || "http://localhost:5173"
// CONVEX_SITE_URL auto-provided by self-hosted backend via CONVEX_SITE_ORIGIN
const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim() || "http://localhost:3211"

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
  const googleEnabled = googleClientId && googleClientSecret

  return betterAuth({
    baseURL: convexSiteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            prompt: "select_account",
          },
        }
      : {},
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  })
}
