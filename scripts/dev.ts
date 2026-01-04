#!/usr/bin/env bun
/**
 * Unified development orchestration script.
 * Cross-platform (Windows/Mac/Linux) TypeScript alternative to shell scripts.
 *
 * Usage:
 *   bun scripts/dev.ts dev           # Start dev servers (mode from .env.local)
 *   bun scripts/dev.ts dev --mode X  # Override mode (local/runpod/datalab)
 *   bun scripts/dev.ts sync          # Sync .env.local to tool-specific files
 *   bun scripts/dev.ts status        # Show current configuration
 *   bun scripts/dev.ts secrets       # Push secrets to Cloudflare Workers
 *   bun scripts/dev.ts deploy        # Deploy to production
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { spawn, type Subprocess } from "bun";

const ROOT_DIR = resolve(dirname(import.meta.path), "..");
const ENV_FILE = resolve(ROOT_DIR, ".env.local");

// Derived env files (generated from root .env.local, gitignored)
const DERIVED_ENV_FILES = {
  frontend: resolve(ROOT_DIR, "frontend/.env.local"),
  api: resolve(ROOT_DIR, "api/.dev.vars"),
} as const;

// System environment variables to pass through to child processes
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

/** Returns a clean environment with only essential system variables */
function getSystemEnv(): Record<string, string> {
  const env: Record<string, string> = {
    BUN_CONFIG_NO_DOTENV: "1", // Prevent Bun from auto-loading parent .env files
  };
  for (const key of SYSTEM_ENV_VARS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

type Env = Record<string, string | undefined>;

// Colors for terminal output
const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

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

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comments (only for unquoted values)
      const commentIndex = value.indexOf(" #");
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    env[key] = value;
  }

  return env;
}

function loadEnv(modeOverride?: string): Env {
  if (!existsSync(ENV_FILE)) {
    console.error(colors.red("Error: .env.local not found"));
    console.log(`Run: ${colors.cyan("cp .env.example .env.local")}`);
    process.exit(1);
  }

  const env = parseEnvFile(ENV_FILE);
  env.BACKEND_MODE = modeOverride || env.BACKEND_MODE || "local";
  return env;
}

function syncConfigs(env: Env): void {
  // Clean slate: delete existing derived env files
  for (const file of Object.values(DERIVED_ENV_FILES)) {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }

  // Generate api/.dev.vars for wrangler (cloud modes only)
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
      // S3 config
      env.S3_ENDPOINT ? `S3_ENDPOINT=${env.S3_ENDPOINT}` : "",
      env.S3_ACCESS_KEY ? `S3_ACCESS_KEY=${env.S3_ACCESS_KEY}` : "",
      env.S3_SECRET_KEY ? `S3_SECRET_KEY=${env.S3_SECRET_KEY}` : "",
      env.S3_BUCKET ? `S3_BUCKET=${env.S3_BUCKET}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(DERIVED_ENV_FILES.api, devVars + "\n");
  }

  // Generate frontend/.env.local for Vite and Convex CLI
  // All dev modes use self-hosted Convex
  const apiUrl = env.API_URL || "http://localhost:8787";
  const frontendEnvLines = [
    "# Auto-generated from .env.local - do not edit directly",
    `VITE_API_URL=${apiUrl}`,
    `VITE_CONVEX_URL=http://localhost:3210`,
    `VITE_CONVEX_SITE_URL=http://localhost:3211`,
    // Self-hosted Convex credentials (for convex CLI)
    `CONVEX_SELF_HOSTED_URL=http://localhost:3210`,
    env.CONVEX_SELF_HOSTED_ADMIN_KEY
      ? `CONVEX_SELF_HOSTED_ADMIN_KEY=${env.CONVEX_SELF_HOSTED_ADMIN_KEY}`
      : "",
  ].filter(Boolean);

  writeFileSync(DERIVED_ENV_FILES.frontend, frontendEnvLines.join("\n") + "\n");

  console.log(colors.green(`Configs synced for mode: ${env.BACKEND_MODE}`));
}

async function generateConvexAdminKey(profileArgs: string[]): Promise<string | null> {
  console.log(colors.cyan("Generating Convex admin key..."));

  const proc = spawn({
    cmd: [
      "docker",
      "compose",
      ...profileArgs,
      "exec",
      "convex-backend",
      "./generate_admin_key.sh",
    ],
    cwd: ROOT_DIR,
    env: getSystemEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.error(colors.red("Failed to generate admin key"));
    return null;
  }

  // Parse the admin key from output (format: "convex-self-hosted|<hex>")
  const match = output.match(/(convex-self-hosted\|\S+)/);
  if (!match) {
    console.error(colors.red("Could not parse admin key from output:"));
    console.error(output || "(empty output)");
    return null;
  }

  const adminKey = match[1];

  // Append to .env.local
  const envContent = readFileSync(ENV_FILE, "utf-8");
  if (!envContent.includes("CONVEX_SELF_HOSTED_ADMIN_KEY")) {
    writeFileSync(
      ENV_FILE,
      envContent + `\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`,
    );
    console.log(colors.green("Admin key saved to .env.local"));
  }

  return adminKey;
}

function generateBetterAuthSecret(): string {
  // Generate a random 32-byte hex string
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Append to .env.local
  const envContent = readFileSync(ENV_FILE, "utf-8");
  if (!envContent.includes("BETTER_AUTH_SECRET")) {
    writeFileSync(ENV_FILE, envContent + `\nBETTER_AUTH_SECRET=${secret}\n`);
    console.log(
      colors.green("Generated BETTER_AUTH_SECRET and saved to .env.local"),
    );
  }

  return secret;
}

async function syncConvexEnv(env: Env): Promise<void> {
  const convexEnvVars: Record<string, string | undefined> = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  };

  const varsToSet = Object.entries(convexEnvVars).filter(
    ([, value]) => value !== undefined,
  );

  if (varsToSet.length === 0) return;

  console.log(colors.cyan("Syncing Convex environment variables..."));

  const convexEnv = { ...getSystemEnv(), ...getConvexEnv(env.CONVEX_SELF_HOSTED_ADMIN_KEY!) };

  for (const [key, value] of varsToSet) {
    const proc = spawn({
      cmd: ["bunx", "convex", "env", "set", key, value!],
      cwd: resolve(ROOT_DIR, "frontend"),
      env: convexEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode === 0) {
      console.log(`  ${key} ${colors.green("✓")}`);
    } else {
      const stderr = await new Response(proc.stderr).text();
      console.log(
        `  ${key} ${colors.yellow("(skipped)")} ${stderr.trim() || ""}`,
      );
    }
  }
}

async function runProcess(
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

/** Build Convex self-hosted env for CLI commands */
function getConvexEnv(adminKey: string): Record<string, string> {
  return {
    CONVEX_SELF_HOSTED_URL: "http://localhost:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  };
}

/** Wait for Convex isolates to be ready (not just healthcheck) */
async function waitForConvexReady(maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch("http://localhost:3210/version");
      if (res.ok) {
        // Add small delay after healthcheck for isolate initialization
        await Bun.sleep(500);
        return;
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(300);
  }
}

async function startDev(env: Env, dashboardEnabled = false): Promise<void> {
  const mode = env.BACKEND_MODE!;
  const processes: Subprocess[] = [];

  // Build profile args (mode profile + optional dashboard profile)
  const profileArgs = ["--profile", mode];
  if (dashboardEnabled) {
    profileArgs.push("--profile", "dashboard");
  }

  const cleanup = async () => {
    console.log("\nShutting down...");
    processes.forEach((p) => p.kill());

    // Stop docker containers
    const dockerDown = await runProcess([
      "docker",
      "compose",
      ...profileArgs,
      "down",
    ]);
    await dockerDown.exited;

    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // All dev modes use self-hosted Convex
  const modeLabel =
    env.BACKEND_MODE === "local"
      ? "Docker worker + Convex + API + Vite"
      : `${env.BACKEND_MODE} backend + Convex + Vite`;

  console.log(colors.green(`\nStarting development (${modeLabel})`));
  if (env.BACKEND_MODE === "local") {
    console.log(
      colors.yellow("Note: Make sure Docker is running with GPU support\n"),
    );
  }

  // Start docker with --wait to ensure Convex is healthy before proceeding
  const dockerUp = await runProcess(
    [
      "docker",
      "compose",
      ...profileArgs,
      "--env-file",
      ".env.local",
      "up",
      "-d",
      "--wait",
    ],
    { cwd: ROOT_DIR, env: { BACKEND_MODE: mode } },
  );
  await dockerUp.exited;

  // Generate admin key if not already set
  if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    const adminKey = await generateConvexAdminKey(profileArgs);
    if (adminKey) {
      env.CONVEX_SELF_HOSTED_ADMIN_KEY = adminKey;
    }
  }

  // Generate auth secret if not already set
  if (!env.BETTER_AUTH_SECRET) {
    env.BETTER_AUTH_SECRET = generateBetterAuthSecret();
  }

  // Wait for Convex isolates to fully initialize (prevents IsolateNotClean errors)
  await waitForConvexReady();

  // Sync configs with admin key
  syncConfigs(env);

  // Sync env vars to Convex (BETTER_AUTH_SECRET, Google OAuth, etc.)
  await syncConvexEnv(env);

  // Show docker logs in background
  processes.push(
    await runProcess(
      ["docker", "compose", ...profileArgs, "logs", "-f"],
      { cwd: ROOT_DIR },
    ),
  );

  // Start Convex dev server (self-hosted)
  const convexEnv = getConvexEnv(env.CONVEX_SELF_HOSTED_ADMIN_KEY!);
  processes.push(
    await runProcess(["bunx", "convex", "dev"], {
      cwd: resolve(ROOT_DIR, "frontend"),
      env: convexEnv,
    }),
  );

  // Start frontend
  processes.push(
    await runProcess(["bun", "run", "dev"], {
      cwd: resolve(ROOT_DIR, "frontend"),
      env: { VITE_API_URL: "http://localhost:8787" },
    }),
  );

  // Wait for all processes
  await Promise.all(processes.map((p) => p.exited));
}

async function pushSecrets(env: Env): Promise<void> {
  if (env.BACKEND_MODE === "local") {
    console.error(colors.yellow("Local mode doesn't use Cloudflare secrets"));
    process.exit(1);
  }

  const secretsByMode: Record<string, string[]> = {
    local: [],
    datalab: ["DATALAB_API_KEY"],
    runpod: [
      "RUNPOD_API_KEY",
      "RUNPOD_ENDPOINT_ID",
      "S3_ENDPOINT",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "S3_BUCKET",
      "GOOGLE_API_KEY",
    ],
  };

  const keys = secretsByMode[env.BACKEND_MODE!] || [];
  const secrets = keys
    .filter((key) => env[key])
    .map((key) => ({ name: key, value: env[key] as string }));

  if (secrets.length === 0) {
    console.log(colors.yellow("No secrets to push"));
    return;
  }

  console.log(
    colors.cyan(`\nPushing secrets for ${env.BACKEND_MODE} environment...\n`),
  );

  for (const secret of secrets) {
    const proc = spawn({
      cmd: [
        "wrangler",
        "secret",
        "put",
        secret.name,
        "--env",
        env.BACKEND_MODE!,
      ],
      cwd: resolve(ROOT_DIR, "api"),
      env: getSystemEnv(),
      stdin: new TextEncoder().encode(secret.value),
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode === 0) {
      console.log(`  ${secret.name} ${colors.green("✓")}`);
    } else {
      const stderr = await new Response(proc.stderr).text();
      console.log(`  ${secret.name} ${colors.red("✗")} ${stderr.trim()}`);
    }
  }

  console.log(colors.green("\nSecrets pushed!"));
}

async function deploy(env: Env): Promise<void> {
  if (env.BACKEND_MODE === "local") {
    console.error(
      colors.yellow("Warning: local mode cannot be deployed to production"),
    );
    console.log("Change BACKEND_MODE to 'runpod' or 'datalab' in .env.local");
    process.exit(1);
  }

  // Require Convex Cloud for production deployment
  const missingConvex: string[] = [];
  if (!env.CONVEX_URL) missingConvex.push("CONVEX_URL");
  if (!env.CONVEX_DEPLOYMENT) missingConvex.push("CONVEX_DEPLOYMENT");

  if (missingConvex.length > 0) {
    console.error(
      colors.red("Convex Cloud is required for production deployment:"),
    );
    missingConvex.forEach((v) => console.error(`  - ${v}`));
    console.log("\nRun `bunx convex dev` in frontend/ to create a deployment,");
    console.log("then add CONVEX_DEPLOYMENT and CONVEX_URL to .env.local");
    process.exit(1);
  }

  console.log(
    colors.green(`\nDeploying with ${env.BACKEND_MODE} backend...\n`),
  );

  // Deploy API
  console.log(colors.cyan("Deploying API worker..."));
  const apiDeploy = await runProcess(
    ["bun", "run", `deploy:${env.BACKEND_MODE}`],
    { cwd: resolve(ROOT_DIR, "api") },
  );
  await apiDeploy.exited;

  // Build frontend
  console.log(colors.cyan("\nBuilding frontend..."));
  if (!env.DEPLOY_API_URL) {
    console.error(colors.red("DEPLOY_API_URL is required for deployment"));
    console.log("Set it in .env.local to your deployed API URL");
    process.exit(1);
  }
  // Derive Convex site URL from Convex URL
  // e.g., https://foo.convex.cloud -> https://foo.convex.site
  const convexSiteUrl = env.CONVEX_URL!.replace(
    ".convex.cloud",
    ".convex.site",
  );

  const frontendBuild = await runProcess(["bun", "run", "build"], {
    cwd: resolve(ROOT_DIR, "frontend"),
    env: {
      VITE_API_URL: env.DEPLOY_API_URL,
      VITE_CONVEX_URL: env.CONVEX_URL!,
      VITE_CONVEX_SITE_URL: convexSiteUrl,
    },
  });
  await frontendBuild.exited;

  // Deploy frontend
  console.log(colors.cyan("\nDeploying frontend..."));
  const frontendDeploy = await runProcess(
    [
      "wrangler",
      "pages",
      "deploy",
      "frontend/dist",
      "--project-name",
      "academic-reader",
    ],
    { cwd: ROOT_DIR },
  );
  await frontendDeploy.exited;

  console.log(colors.green("\nDeployment complete!"));
}

// CLI entry point
const args = process.argv.slice(2);
const command = args[0];
const modeIndex = args.indexOf("--mode");
const modeOverride = modeIndex !== -1 ? args[modeIndex + 1] : undefined;
const dashboardEnabled = args.includes("--dashboard");

switch (command) {
  case "dev": {
    const env = loadEnv(modeOverride);
    await startDev(env, dashboardEnabled);
    break;
  }
  case "deploy": {
    const env = loadEnv(modeOverride);
    await deploy(env);
    break;
  }
  case "secrets": {
    const env = loadEnv(modeOverride);
    await pushSecrets(env);
    break;
  }
  default:
    console.log(`
${colors.bold("Academic Reader Dev Script")}

Usage: bun scripts/dev.ts <command> [options]

Commands:
  ${colors.cyan("dev")}       Start development servers
  ${colors.cyan("secrets")}   Push secrets to Cloudflare Workers
  ${colors.cyan("deploy")}    Deploy to Cloudflare

Options:
  ${colors.cyan("--mode <mode>")}   Override BACKEND_MODE (local/runpod/datalab)
  ${colors.cyan("--dashboard")}     Enable Convex dashboard (http://localhost:6791)

Modes (dev):
  ${colors.cyan("local")}    Docker worker + self-hosted Convex + Vite
  ${colors.cyan("datalab")}  Datalab API + self-hosted Convex + Vite
  ${colors.cyan("runpod")}   Runpod + MinIO + self-hosted Convex + Vite

Modes (deploy):
  ${colors.cyan("datalab")}  Datalab API + Convex Cloud
  ${colors.cyan("runpod")}   Runpod + S3 + Convex Cloud

Examples:
  bun scripts/dev.ts dev                  # Use mode from .env.local
  bun scripts/dev.ts dev --mode datalab   # Override to datalab
  bun scripts/dev.ts dev --dashboard      # Enable Convex dashboard
`);
    break;
}
