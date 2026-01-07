import { resolve } from "path"
import { spawn, type Subprocess } from "bun"
import type { Command, CommandOptions, Env } from "./types"
import {
  ROOT_DIR,
  colors,
  syncConfigs,
  runProcess,
  generateBetterAuthSecret,
} from "./utils"
import {
  getConvexEnv,
  generateConvexAdminKey,
  parseAdminKey,
  syncConvexEnv,
  deployConvexFunctions,
} from "./convex"
import { validateEnv, devEnvRules, deployEnvRules } from "./env"

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
  ${colors.cyan("dev")}       Start development servers
  ${colors.cyan("deploy")}    Deploy to production (VPS + Cloudflare Pages)

Options:
  ${colors.cyan("--mode <mode>")}   Override BACKEND_MODE (local/runpod/datalab)
  ${colors.cyan("--dashboard")}     Enable Convex dashboard (http://localhost:6791)

Modes:
  ${colors.cyan("local")}    Docker worker + self-hosted Convex + Vite
  ${colors.cyan("datalab")}  Datalab API + self-hosted Convex + Vite
  ${colors.cyan("runpod")}   Runpod + MinIO + self-hosted Convex + Vite

Examples:
  bun scripts/dev.ts dev                  # Use mode from .env.dev
  bun scripts/dev.ts dev --mode datalab   # Override to datalab
  bun scripts/dev.ts deploy               # Deploy to production
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
        ".env.dev",
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
        ".env.dev",
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
    syncConfigs(env)
    await syncConvexEnv(env, convexEnv)

    processes.push(
      await runProcess(
        [
          "docker",
          "compose",
          ...profileArgs,
          "--env-file",
          ".env.dev",
          "logs",
          "-f",
        ],
        { cwd: ROOT_DIR },
      ),
    )
    processes.push(
      await runProcess(["bunx", "convex", "dev"], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: convexEnv,
      }),
    )

    // Parse port from SITE_URL (e.g., http://localhost:5173 → 5173)
    const siteUrl = env.SITE_URL!
    const apiUrl = env.API_URL || "http://localhost:8787"
    const sitePort = new URL(siteUrl).port || "5173"

    processes.push(
      await runProcess(["bun", "run", "dev", "--port", sitePort], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: { VITE_API_URL: apiUrl },
      }),
    )

    await Promise.all(processes.map((p) => p.exited))
  },
}

const deployCommand: Command = {
  name: "deploy",
  description: "Deploy to production (VPS + Cloudflare Pages)",
  async execute(env: Env): Promise<void> {
    validateEnv(env, deployEnvRules)

    // Derive URLs from PROD_DOMAIN
    const domain = env.PROD_DOMAIN!
    const apiUrl = `https://${domain}/api`
    const siteUrl = `https://${domain}`
    const convexUrl = `https://convex.${domain}`

    const sshTarget = `${env.PROD_VPS_USER}@${env.PROD_VPS_HOST_IP}`
    const vpsPath = env.PROD_VPS_PATH!

    console.log(colors.green(`\nDeploying to production\n`))

    // 1. Deploy containers to VPS
    console.log(colors.cyan("Deploying to VPS..."))
    const deployProcess = await runProcess([
      "ssh",
      sshTarget,
      `cd ${vpsPath} && git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`,
    ])
    await deployProcess.exited
    if (deployProcess.exitCode !== 0) {
      console.error(colors.red("VPS deployment failed"))
      process.exit(1)
    }
    console.log(colors.green("✓ Containers deployed to VPS\n"))

    // 2. Fetch or generate prod admin key from VPS
    console.log(colors.cyan("Fetching Convex admin key from VPS..."))
    const fetchKeyProc = spawn({
      cmd: [
        "ssh",
        sshTarget,
        `grep '^CONVEX_SELF_HOSTED_ADMIN_KEY=' ${vpsPath}/.env.production | cut -d'=' -f2-`,
      ],
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    })
    let prodAdminKey = (await new Response(fetchKeyProc.stdout).text()).trim()
    await fetchKeyProc.exited

    if (!prodAdminKey) {
      console.log(colors.yellow("Admin key not found, generating..."))
      const genKeyProc = spawn({
        cmd: [
          "ssh",
          sshTarget,
          `docker exec academic-reader-convex-backend-1 ./generate_admin_key.sh`,
        ],
        cwd: ROOT_DIR,
        stdout: "pipe",
        stderr: "pipe",
      })
      const genOutput = await new Response(genKeyProc.stdout).text()
      await genKeyProc.exited

      prodAdminKey = parseAdminKey(genOutput) ?? ""
      if (!prodAdminKey) {
        console.error(colors.red("Failed to generate admin key on VPS"))
        console.error(genOutput || "(empty output)")
        process.exit(1)
      }

      // Save to .env.production on VPS
      const saveKeyProc = spawn({
        cmd: [
          "ssh",
          sshTarget,
          `echo 'CONVEX_SELF_HOSTED_ADMIN_KEY=${prodAdminKey}' >> ${vpsPath}/.env.production`,
        ],
        cwd: ROOT_DIR,
        stdout: "pipe",
        stderr: "pipe",
      })
      await saveKeyProc.exited
      console.log(colors.green("✓ Admin key generated and saved to VPS\n"))
    } else {
      console.log(colors.green("✓ Admin key retrieved\n"))
    }

    // 3. Deploy Convex functions
    const convexEnv = getConvexEnv(prodAdminKey, convexUrl)

    const convexDeployed = await deployConvexFunctions(convexEnv)
    if (!convexDeployed) {
      console.error(colors.red("Convex deployment failed"))
      process.exit(1)
    }
    console.log(colors.green("✓ Convex functions deployed\n"))

    // 4. Sync Convex environment variables
    await syncConvexEnv(env, convexEnv, siteUrl)
    console.log(colors.green("✓ Convex environment synced\n"))

    // 5. Build frontend with prod vars
    console.log(colors.cyan("Building frontend..."))
    const buildProcess = await runProcess(["bun", "run", "build"], {
      cwd: resolve(ROOT_DIR, "frontend"),
      env: {
        VITE_API_URL: apiUrl,
        VITE_CONVEX_URL: convexUrl,
        VITE_CONVEX_SITE_URL: siteUrl,
      },
    })
    await buildProcess.exited
    if (buildProcess.exitCode !== 0) {
      console.error(colors.red("Frontend build failed"))
      process.exit(1)
    }
    console.log(colors.green("✓ Frontend built\n"))

    // 6. Write wrangler.toml with env vars
    const wranglerConfig = `name = "academic-reader"
pages_build_output_dir = "./dist"

[vars]
API_HOST = "api.${domain}"
CONVEX_SITE_HOST = "convex-site.${domain}"
`
    await Bun.write(resolve(ROOT_DIR, "frontend/wrangler.toml"), wranglerConfig)

    // 7. Deploy to Cloudflare Pages
    console.log(colors.cyan("Deploying to Cloudflare Pages..."))
    const pagesProcess = await runProcess(
      ["bunx", "wrangler", "pages", "deploy"],
      { cwd: resolve(ROOT_DIR, "frontend") },
    )
    await pagesProcess.exited
    if (pagesProcess.exitCode !== 0) {
      console.error(colors.red("Cloudflare Pages deployment failed"))
      process.exit(1)
    }

    console.log(colors.green("\n✓ Deploy complete!"))
    console.log(`  API: ${apiUrl}`)
    console.log(`  Site: ${siteUrl}`)
  },
}

// =============================================================================
// Registry
// =============================================================================

const commands: Command[] = [devCommand, deployCommand]
