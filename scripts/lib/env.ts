import type { Env } from "./types"
import { colors } from "./utils"

// =============================================================================
// Validation Rules
// =============================================================================

type EnvRule = {
  key: string
  required?: boolean | ((env: Env) => boolean)
  message?: string
}

// prettier-ignore
export const devEnvRules: EnvRule[] = [
  { key: "BACKEND_MODE", required: true, message: "Set BACKEND_MODE to 'local', 'datalab', or 'runpod'" },
  { key: "SITE_URL", required: true },
  { key: "GOOGLE_API_KEY", required: (env) => env.BACKEND_MODE !== "datalab" },
  { key: "DATALAB_API_KEY", required: (env) => env.BACKEND_MODE === "datalab" },
  { key: "RUNPOD_API_KEY", required: (env) => env.BACKEND_MODE === "runpod" },
  { key: "RUNPOD_MARKER_ENDPOINT_ID", required: (env) => env.BACKEND_MODE === "runpod" },
  { key: "RUNPOD_TTS_ENDPOINT_ID", required: (env) => env.BACKEND_MODE === "runpod" },
];

// =============================================================================
// Helpers
// =============================================================================

export function validateEnv(env: Env, rules: EnvRule[]): void {
  const errors: string[] = []

  for (const rule of rules) {
    const isRequired =
      typeof rule.required === "function" ? rule.required(env) : rule.required

    if (isRequired && !env[rule.key]) {
      errors.push(rule.message || `Missing ${rule.key}`)
    }
  }

  if (errors.length) {
    errors.forEach((e) => console.error(colors.red(e)))
    process.exit(1)
  }
}
