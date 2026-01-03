import { betterAuth } from "better-auth"
import { createClient } from "@convex-dev/better-auth"
import { crossDomain, convex } from "@convex-dev/better-auth/plugins"
import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import type { GenericCtx } from "@convex-dev/better-auth"
import authConfig from "./auth.config"

const siteUrl = process.env.SITE_URL || "http://localhost:5173"

function getRequiredEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const googleClientId = getRequiredEnvVar("GOOGLE_CLIENT_ID")
const googleClientSecret = getRequiredEnvVar("GOOGLE_CLIENT_SECRET")
const convexSiteUrl = getRequiredEnvVar("CONVEX_SITE_URL")

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: convexSiteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        prompt: "select_account",
      },
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  })
}
