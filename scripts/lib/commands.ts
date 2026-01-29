import { resolve } from "path"
import type { Subprocess } from "bun"
import type { Command, CommandOptions, Env } from "./types"
import {
  ROOT_DIR,
  colors,
  runProcess,
  runProcessSync,
  generateBetterAuthSecret,
} from "./utils"
import {
  getConvexEnv,
  generateConvexAdminKey,
  syncConvexEnv,
} from "./convex"
import { validateEnv, devEnvRules } from "./env"
import { generateMusicPreviews } from "./audio"

// =============================================================================
// Public API
// =============================================================================

export function getCommand(name: string | undefined): Command | undefined {
  return commands.find((c) => c.name === name)
}

export function printUsage(): void {
  console.log(`
${colors.bold("Academic Reader Dev Script")}

Usage: bun scripts/dev.ts <command> [options]

Commands:
  ${colors.cyan("setup")}     Install and configure external dependencies
  ${colors.cyan("dev")}       Start development servers

Options:
  ${colors.cyan("--mode <mode>")}   Override BACKEND_MODE (local/datalab/modal)
  ${colors.cyan("--dashboard")}     Enable Convex dashboard (http://localhost:6791)

Modes:
  ${colors.cyan("local")}    Docker worker + self-hosted Convex + Vite
  ${colors.cyan("datalab")}  Datalab API + self-hosted Convex + Vite
  ${colors.cyan("modal")}    Modal cloud GPU + MinIO + self-hosted Convex + Vite

Examples:
  bun scripts/dev.ts setup                # First-time setup
  bun scripts/dev.ts dev                  # Use mode from .env.local
  bun scripts/dev.ts dev --mode datalab   # Override to datalab
`)
}

// =============================================================================
// Commands
// =============================================================================

const devCommand: Command = {
  name: "dev",
  description: "Start development servers",
  async execute(env: Env, options: CommandOptions): Promise<void> {
    validateEnv(env, devEnvRules)
    await generateMusicPreviews()

    const mode = env.BACKEND_MODE!
    const processes: Subprocess[] = []

    const profileArgs = ["--profile", mode]
    if (options.dashboardEnabled) {
      profileArgs.push("--profile", "dashboard")
    }

    const cleanup = async () => {
      console.log("\nShutting down...")
      processes.forEach((p) => p.kill())
      const dockerDown = await runProcess([
        "docker",
        "compose",
        ...profileArgs,
        "--env-file",
        ".env.local",
        "down",
      ])
      await dockerDown.exited
      process.exit(0)
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)

    const modeLabel =
      mode === "local"
        ? "Docker worker + Convex + API + Vite"
        : `${mode} backend + Convex + Vite`

    console.log(colors.green(`\nStarting development (${modeLabel})`))
    if (mode === "local") {
      console.log(
        colors.yellow("Note: Make sure Docker is running with GPU support\n"),
      )
    }

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
    )
    await dockerUp.exited

    if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
      const adminKey = await generateConvexAdminKey(profileArgs)
      if (adminKey) env.CONVEX_SELF_HOSTED_ADMIN_KEY = adminKey
    }

    if (!env.BETTER_AUTH_SECRET) {
      env.BETTER_AUTH_SECRET = generateBetterAuthSecret()
    }

    const convexEnv = getConvexEnv(env.CONVEX_SELF_HOSTED_ADMIN_KEY!)
    await syncConvexEnv(env, convexEnv, env.SITE_URL)

    processes.push(
      await runProcess(
        [
          "docker",
          "compose",
          ...profileArgs,
          "--env-file",
          ".env.local",
          "logs",
          "-f",
        ],
        { cwd: ROOT_DIR },
      ),
    )
    processes.push(
      await runProcess(["bunx", "convex", "dev"], {
        cwd: resolve(ROOT_DIR, "shared/convex"),
        env: convexEnv,
      }),
    )

    // Parse port from SITE_URL (e.g., http://localhost:5173 → 5173)
    const siteUrl = env.SITE_URL!
    const apiUrl = env.API_URL || "http://localhost:8787"
    const sitePort = new URL(siteUrl).port || "5173"

    processes.push(
      await runProcess(["bun", "run", "dev", "--port", sitePort], {
        cwd: resolve(ROOT_DIR, "web"),
        env: { VITE_API_URL: apiUrl, BACKEND_MODE: mode },
      }),
    )

    await Promise.all(processes.map((p) => p.exited))
  },
}

// =============================================================================
// Setup Command
// =============================================================================

const setupCommand: Command = {
  name: "setup",
  description: "Install and configure external dependencies",
  async execute(env: Env): Promise<void> {
    console.log(colors.bold("\nSetting up development environment...\n"))

    await setupModal(env)

    console.log(colors.green("\n✓ Setup complete!\n"))
  },
}

async function setupModal(env: Env): Promise<void> {
  console.log(colors.cyan("Checking Modal CLI..."))

  // Check if modal is installed
  const modalCheck = runProcessSync(["modal", "--version"])
  if (!modalCheck.success) {
    console.log("  Modal CLI not found. Installing via uv...")
    const install = await runProcess(["uv", "tool", "install", "modal"])
    await install.exited

    // Re-check
    const recheck = runProcessSync(["modal", "--version"])
    if (!recheck.success) {
      console.log(colors.red("\n✗ Failed to install Modal CLI."))
      console.log("  Please install manually: uv tool install modal")
      process.exit(1)
    }
  }
  console.log(colors.green("  ✓ Modal CLI installed"))

  // Check if authenticated (modal token info returns non-zero if not authenticated)
  const authCheck = runProcessSync(["modal", "token", "info"])
  if (!authCheck.success) {
    console.log("  Modal not authenticated. Running setup (opens browser)...")
    const setup = await runProcess(["modal", "setup"])
    await setup.exited
  }
  console.log(colors.green("  ✓ Modal authenticated"))

  // Create Modal secrets from .env.local
  if (env.GOOGLE_API_KEY) {
    console.log(colors.cyan("Creating Modal secrets..."))
    runProcessSync([
      "modal",
      "secret",
      "create",
      "google-api-key",
      `GOOGLE_API_KEY=${env.GOOGLE_API_KEY}`,
    ])
    console.log(colors.green("  ✓ Modal secret 'google-api-key' created"))
  } else {
    console.log(colors.yellow("  ⚠ GOOGLE_API_KEY not found in .env.local"))
  }
}

// =============================================================================
// Registry
// =============================================================================

const commands: Command[] = [setupCommand, devCommand]
