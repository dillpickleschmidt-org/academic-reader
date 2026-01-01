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
 *   bun scripts/dev.ts deploy        # Deploy to production
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { spawn, type Subprocess } from "bun";

const ROOT_DIR = resolve(dirname(import.meta.path), "..");
const ENV_FILE = resolve(ROOT_DIR, ".env.local");

type BackendMode = "local" | "runpod" | "datalab";

interface Config {
  BACKEND_MODE: BackendMode;
  GOOGLE_API_KEY?: string;
  DATALAB_API_KEY?: string;
  RUNPOD_API_KEY?: string;
  RUNPOD_ENDPOINT_ID?: string;
  WEBHOOK_SECRET?: string;
  CORS_ORIGINS?: string;
  API_URL?: string;
  LOCAL_WORKER_URL?: string;
  // S3 storage (for Runpod)
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_BUCKET?: string;
  S3_PUBLIC_URL?: string;
}

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
    }

    env[key] = value;
  }

  return env;
}

function loadConfig(modeOverride?: string): Config {
  if (!existsSync(ENV_FILE)) {
    console.error(colors.red("Error: .env.local not found"));
    console.log(`Run: ${colors.cyan("cp .env.example .env.local")}`);
    process.exit(1);
  }

  const env = parseEnvFile(ENV_FILE);
  const mode = (modeOverride || env.BACKEND_MODE || "local") as BackendMode;

  return {
    BACKEND_MODE: mode,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    DATALAB_API_KEY: env.DATALAB_API_KEY,
    RUNPOD_API_KEY: env.RUNPOD_API_KEY,
    RUNPOD_ENDPOINT_ID: env.RUNPOD_ENDPOINT_ID,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    CORS_ORIGINS: env.CORS_ORIGINS,
    API_URL: env.API_URL,
    LOCAL_WORKER_URL: env.LOCAL_WORKER_URL || "http://localhost:8000",
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_ACCESS_KEY: env.S3_ACCESS_KEY,
    S3_SECRET_KEY: env.S3_SECRET_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_PUBLIC_URL: env.S3_PUBLIC_URL,
  };
}

function validateConfig(config: Config): void {
  const missing: string[] = [];

  switch (config.BACKEND_MODE) {
    case "runpod":
      if (!config.RUNPOD_API_KEY) missing.push("RUNPOD_API_KEY");
      if (!config.RUNPOD_ENDPOINT_ID) missing.push("RUNPOD_ENDPOINT_ID");
      break;
    case "datalab":
      if (!config.DATALAB_API_KEY) missing.push("DATALAB_API_KEY");
      break;
    case "local":
      // No required secrets for local mode
      break;
  }

  if (missing.length > 0) {
    console.error(
      colors.red(`Missing required variables for ${config.BACKEND_MODE} mode:`),
    );
    missing.forEach((v) => console.error(`  - ${v}`));
    process.exit(1);
  }
}

function syncConfigs(config: Config): void {
  // Generate api/.dev.vars for wrangler (cloud modes only)
  if (config.BACKEND_MODE !== "local") {
    const devVars = [
      "# Auto-generated from .env.local - do not edit directly",
      `CONVERSION_BACKEND=${config.BACKEND_MODE}`,
      config.GOOGLE_API_KEY ? `GOOGLE_API_KEY=${config.GOOGLE_API_KEY}` : "",
      config.DATALAB_API_KEY ? `DATALAB_API_KEY=${config.DATALAB_API_KEY}` : "",
      config.RUNPOD_API_KEY ? `RUNPOD_API_KEY=${config.RUNPOD_API_KEY}` : "",
      config.RUNPOD_ENDPOINT_ID
        ? `RUNPOD_ENDPOINT_ID=${config.RUNPOD_ENDPOINT_ID}`
        : "",
      config.WEBHOOK_SECRET ? `WEBHOOK_SECRET=${config.WEBHOOK_SECRET}` : "",
      config.CORS_ORIGINS ? `CORS_ORIGINS=${config.CORS_ORIGINS}` : "",
      // S3 config
      config.S3_ENDPOINT ? `S3_ENDPOINT=${config.S3_ENDPOINT}` : "",
      config.S3_ACCESS_KEY ? `S3_ACCESS_KEY=${config.S3_ACCESS_KEY}` : "",
      config.S3_SECRET_KEY ? `S3_SECRET_KEY=${config.S3_SECRET_KEY}` : "",
      config.S3_BUCKET ? `S3_BUCKET=${config.S3_BUCKET}` : "",
      config.S3_PUBLIC_URL ? `S3_PUBLIC_URL=${config.S3_PUBLIC_URL}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(resolve(ROOT_DIR, "api/.dev.vars"), devVars + "\n");
  }

  // Generate frontend/.env.local for Vite
  // Always use :8787 (Hono API) - it handles all backends and SSE properly
  const apiUrl = config.API_URL || "http://localhost:8787";
  writeFileSync(
    resolve(ROOT_DIR, "frontend/.env.local"),
    `VITE_API_URL=${apiUrl}\n`,
  );

  console.log(colors.green(`Configs synced for mode: ${config.BACKEND_MODE}`));
}

function showStatus(config: Config): void {
  const set = colors.green("[set]");
  const notSet = colors.yellow("[not set]");
  const showVar = (name: string, value: string | undefined, indent = 2) =>
    console.log(
      `${" ".repeat(indent)}${name.padEnd(23 - indent)} ${value ? set : notSet}`,
    );

  console.log(colors.bold("\nAcademic Reader Configuration"));
  console.log("─".repeat(40));
  console.log(`BACKEND_MODE         ${colors.cyan(config.BACKEND_MODE)}`);
  console.log("");
  console.log(colors.bold("Datalab (fully managed)"));
  showVar("DATALAB_API_KEY", config.DATALAB_API_KEY);
  console.log("");
  console.log(colors.bold("Runpod (self-hosted)"));
  showVar("RUNPOD_API_KEY", config.RUNPOD_API_KEY);
  showVar("RUNPOD_ENDPOINT_ID", config.RUNPOD_ENDPOINT_ID);
  showVar("GOOGLE_API_KEY", config.GOOGLE_API_KEY);
  console.log("");
  console.log(colors.bold("S3 Storage (for Runpod)"));
  showVar("S3_ENDPOINT", config.S3_ENDPOINT);
  showVar("S3_ACCESS_KEY", config.S3_ACCESS_KEY);
  showVar("S3_SECRET_KEY", config.S3_SECRET_KEY);
  showVar("S3_BUCKET", config.S3_BUCKET);
  console.log("");
}

async function runProcess(
  cmd: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<Subprocess> {
  return spawn({
    cmd,
    cwd: options?.cwd || ROOT_DIR,
    env: { ...process.env, ...options?.env },
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function startDev(config: Config): Promise<void> {
  validateConfig(config);
  syncConfigs(config);

  const processes: Subprocess[] = [];

  const cleanup = async () => {
    console.log("\nShutting down...");
    processes.forEach((p) => p.kill());

    // Stop docker containers
    const dockerDown = spawn({
      cmd: [
        "docker",
        "compose",
        "--profile",
        config.BACKEND_MODE,
        "down",
      ],
      cwd: ROOT_DIR,
      stdout: "inherit",
      stderr: "inherit",
    });
    await dockerDown.exited;

    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (config.BACKEND_MODE === "local") {
    console.log(
      colors.green("\nStarting local development (Docker worker + API + Vite)"),
    );
    console.log(
      colors.yellow("Note: Make sure Docker is running with GPU support\n"),
    );

    // Start docker worker with profile
    processes.push(
      await runProcess(
        [
          "docker",
          "compose",
          "--profile",
          "local",
          "--env-file",
          ".env.local",
          "up",
        ],
        { cwd: ROOT_DIR, env: { BACKEND_MODE: "local" } },
      ),
    );

    // Wait for worker and API to be ready
    await Bun.sleep(3000);

    // Start frontend (talks to API layer which proxies to worker)
    processes.push(
      await runProcess(["bun", "run", "dev"], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: { VITE_API_URL: "http://localhost:8787" },
      }),
    );
  } else {
    console.log(
      colors.green(
        `\nStarting self-hosted development (${config.BACKEND_MODE} backend)`,
      ),
    );

    // Start docker compose with appropriate profile (detached)
    // datalab: just API
    // runpod: API + MinIO
    const dockerUp = await runProcess(
      [
        "docker",
        "compose",
        "--profile",
        config.BACKEND_MODE,
        "--env-file",
        ".env.local",
        "up",
        "-d",
      ],
      { cwd: ROOT_DIR, env: { BACKEND_MODE: config.BACKEND_MODE } },
    );
    await dockerUp.exited;

    // Show docker logs in background
    processes.push(
      await runProcess(
        [
          "docker",
          "compose",
          "--profile",
          config.BACKEND_MODE,
          "logs",
          "-f",
        ],
        { cwd: ROOT_DIR },
      ),
    );

    // Wait for services to be ready
    await Bun.sleep(3000);

    // Start frontend (talks to API layer)
    processes.push(
      await runProcess(["bun", "run", "dev"], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: { VITE_API_URL: "http://localhost:8787" },
      }),
    );
  }

  // Wait for all processes
  await Promise.all(processes.map((p) => p.exited));
}

async function deploy(config: Config): Promise<void> {
  if (config.BACKEND_MODE === "local") {
    console.error(
      colors.yellow("Warning: local mode cannot be deployed to production"),
    );
    console.log("Change BACKEND_MODE to 'runpod' or 'datalab' in .env.local");
    process.exit(1);
  }

  validateConfig(config);

  console.log(
    colors.green(`\nDeploying with ${config.BACKEND_MODE} backend...\n`),
  );

  // Deploy API
  console.log(colors.cyan("Deploying API worker..."));
  const apiDeploy = await runProcess(
    ["bun", "run", `deploy:${config.BACKEND_MODE}`],
    { cwd: resolve(ROOT_DIR, "api") },
  );
  await apiDeploy.exited;

  // Build frontend
  console.log(colors.cyan("\nBuilding frontend..."));
  const frontendBuild = await runProcess(["bun", "run", "build"], {
    cwd: resolve(ROOT_DIR, "frontend"),
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

switch (command) {
  case "status": {
    const config = loadConfig(modeOverride);
    showStatus(config);
    break;
  }
  case "sync": {
    const config = loadConfig(modeOverride);
    syncConfigs(config);
    break;
  }
  case "dev": {
    const config = loadConfig(modeOverride);
    await startDev(config);
    break;
  }
  case "deploy": {
    const config = loadConfig(modeOverride);
    await deploy(config);
    break;
  }
  default:
    console.log(`
${colors.bold("Academic Reader Dev Script")}

Usage: bun scripts/dev.ts <command> [options]

Commands:
  ${colors.cyan("status")}   Show current configuration
  ${colors.cyan("sync")}     Sync .env.local to tool-specific files
  ${colors.cyan("dev")}      Start development servers
  ${colors.cyan("deploy")}   Deploy to Cloudflare

Options:
  ${colors.cyan("--mode <mode>")}  Override BACKEND_MODE (local/runpod/datalab)

Modes:
  ${colors.cyan("local")}    GPU worker + Vite (fully offline)
  ${colors.cyan("datalab")}  Self-hosted API + Vite (direct upload to Datalab)
  ${colors.cyan("runpod")}   Self-hosted API + MinIO + Vite (S3 storage for Runpod)

Examples:
  bun scripts/dev.ts dev              # Use mode from .env.local
  bun scripts/dev.ts dev --mode datalab   # Override to datalab
  bun scripts/dev.ts status           # Check configuration
`);
    break;
}
