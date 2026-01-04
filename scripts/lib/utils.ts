import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { spawn, type Subprocess } from "bun";
import type { Env } from "./types";

// =============================================================================
// Constants
// =============================================================================

export const ROOT_DIR = resolve(dirname(import.meta.path), "../..");
export const ENV_FILE = resolve(ROOT_DIR, ".env.local");

export const DERIVED_ENV_FILES = {
  frontend: resolve(ROOT_DIR, "frontend/.env.local"),
  api: resolve(ROOT_DIR, "api/.dev.vars"),
} as const;

export const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// =============================================================================
// Public API
// =============================================================================

export function loadEnv(modeOverride?: string): Env {
  if (!existsSync(ENV_FILE)) {
    console.error(colors.red("Error: .env.local not found"));
    console.log(`Run: ${colors.cyan("cp .env.example .env.local")}`);
    process.exit(1);
  }

  const env = parseEnvFile(ENV_FILE);
  env.BACKEND_MODE = modeOverride || env.BACKEND_MODE || "local";
  return env;
}

export function syncConfigs(env: Env): void {
  for (const file of Object.values(DERIVED_ENV_FILES)) {
    if (existsSync(file)) unlinkSync(file);
  }

  if (env.BACKEND_MODE !== "local") {
    const devVars = [
      "# Auto-generated from .env.local - do not edit directly",
      `BACKEND_MODE=${env.BACKEND_MODE}`,
      env.GOOGLE_API_KEY ? `GOOGLE_API_KEY=${env.GOOGLE_API_KEY}` : "",
      env.DATALAB_API_KEY ? `DATALAB_API_KEY=${env.DATALAB_API_KEY}` : "",
      env.RUNPOD_API_KEY ? `RUNPOD_API_KEY=${env.RUNPOD_API_KEY}` : "",
      env.RUNPOD_ENDPOINT_ID
        ? `RUNPOD_ENDPOINT_ID=${env.RUNPOD_ENDPOINT_ID}`
        : "",
      env.CORS_ORIGINS ? `CORS_ORIGINS=${env.CORS_ORIGINS}` : "",
      env.S3_ENDPOINT ? `S3_ENDPOINT=${env.S3_ENDPOINT}` : "",
      env.S3_ACCESS_KEY ? `S3_ACCESS_KEY=${env.S3_ACCESS_KEY}` : "",
      env.S3_SECRET_KEY ? `S3_SECRET_KEY=${env.S3_SECRET_KEY}` : "",
      env.S3_BUCKET ? `S3_BUCKET=${env.S3_BUCKET}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(DERIVED_ENV_FILES.api, devVars + "\n");
  }

  const apiUrl = env.API_URL || "http://localhost:8787";
  const frontendEnvLines = [
    "# Auto-generated from .env.local - do not edit directly",
    `VITE_API_URL=${apiUrl}`,
    `VITE_CONVEX_URL=http://localhost:3210`,
    `VITE_CONVEX_SITE_URL=http://localhost:3211`,
    `CONVEX_SELF_HOSTED_URL=http://localhost:3210`,
    env.CONVEX_SELF_HOSTED_ADMIN_KEY
      ? `CONVEX_SELF_HOSTED_ADMIN_KEY=${env.CONVEX_SELF_HOSTED_ADMIN_KEY}`
      : "",
  ].filter(Boolean);

  writeFileSync(DERIVED_ENV_FILES.frontend, frontendEnvLines.join("\n") + "\n");
  console.log(colors.green(`Configs synced for mode: ${env.BACKEND_MODE}`));
}

export async function runProcess(
  cmd: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<Subprocess> {
  return spawn({
    cmd,
    cwd: options?.cwd || ROOT_DIR,
    env: { ...getSystemEnv(), ...options?.env },
    stdout: "inherit",
    stderr: "inherit",
  });
}

export function generateBetterAuthSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const envContent = readFileSync(ENV_FILE, "utf-8");
  if (!envContent.includes("BETTER_AUTH_SECRET")) {
    writeFileSync(ENV_FILE, envContent + `\nBETTER_AUTH_SECRET=${secret}\n`);
    console.log(
      colors.green("Generated BETTER_AUTH_SECRET and saved to .env.local"),
    );
  }

  return secret;
}

// =============================================================================
// Helpers
// =============================================================================

const SYSTEM_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "XDG_RUNTIME_DIR",
] as const;

export function getSystemEnv(): Record<string, string> {
  const env: Record<string, string> = { BUN_CONFIG_NO_DOTENV: "1" };
  for (const key of SYSTEM_ENV_VARS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const content = readFileSync(path, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    env[key] = value;
  }

  return env;
}
