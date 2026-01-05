import { resolve } from "path";
import { spawn } from "bun";
import type { Subprocess } from "bun";
import type { Command, CommandOptions, Env } from "./types";
import {
  ROOT_DIR,
  colors,
  syncConfigs,
  runProcess,
  generateBetterAuthSecret,
  getSystemEnv,
} from "./utils";
import {
  getConvexEnv,
  generateConvexAdminKey,
  syncConvexEnvDev,
  syncConvexEnvProd,
} from "./convex";

// =============================================================================
// Public API
// =============================================================================

export function getCommand(name: string | undefined): Command | undefined {
  return commands.find((c) => c.name === name);
}

export function printUsage(): void {
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
}

// =============================================================================
// Commands
// =============================================================================

const devCommand: Command = {
  name: "dev",
  description: "Start development servers",
  async execute(env: Env, options: CommandOptions): Promise<void> {
    const mode = env.BACKEND_MODE!;
    const processes: Subprocess[] = [];

    const profileArgs = ["--profile", mode];
    if (options.dashboardEnabled) {
      profileArgs.push("--profile", "dashboard");
    }

    const cleanup = async () => {
      console.log("\nShutting down...");
      processes.forEach((p) => p.kill());
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

    const modeLabel =
      mode === "local"
        ? "Docker worker + Convex + API + Vite"
        : `${mode} backend + Convex + Vite`;

    console.log(colors.green(`\nStarting development (${modeLabel})`));
    if (mode === "local") {
      console.log(
        colors.yellow("Note: Make sure Docker is running with GPU support\n"),
      );
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
    );
    await dockerUp.exited;

    if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
      const adminKey = await generateConvexAdminKey(profileArgs);
      if (adminKey) env.CONVEX_SELF_HOSTED_ADMIN_KEY = adminKey;
    }

    if (!env.BETTER_AUTH_SECRET) {
      env.BETTER_AUTH_SECRET = generateBetterAuthSecret();
    }

    syncConfigs(env);
    await syncConvexEnvDev(env);

    processes.push(
      await runProcess(["docker", "compose", ...profileArgs, "logs", "-f"], {
        cwd: ROOT_DIR,
      }),
    );

    const convexEnv = getConvexEnv(env.CONVEX_SELF_HOSTED_ADMIN_KEY!);
    processes.push(
      await runProcess(["bunx", "convex", "dev"], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: convexEnv,
      }),
    );

    processes.push(
      await runProcess(["bun", "run", "dev"], {
        cwd: resolve(ROOT_DIR, "frontend"),
        env: { VITE_API_URL: "http://localhost:8787" },
      }),
    );

    await Promise.all(processes.map((p) => p.exited));
  },
};

const deployCommand: Command = {
  name: "deploy",
  description: "Deploy to Cloudflare",
  async execute(env: Env): Promise<void> {
    if (env.BACKEND_MODE === "local") {
      console.error(
        colors.yellow("Warning: local mode cannot be deployed to production"),
      );
      console.log("Change BACKEND_MODE to 'runpod' or 'datalab' in .env.local");
      process.exit(1);
    }

    const missingConvex: string[] = [];
    if (!env.CONVEX_URL) missingConvex.push("CONVEX_URL");
    if (!env.CONVEX_DEPLOYMENT) missingConvex.push("CONVEX_DEPLOYMENT");

    if (missingConvex.length > 0) {
      console.error(
        colors.red("Convex Cloud is required for production deployment:"),
      );
      missingConvex.forEach((v) => console.error(`  - ${v}`));
      console.log(
        "\nRun `bunx convex dev` in frontend/ to create a deployment,",
      );
      console.log("then add CONVEX_DEPLOYMENT and CONVEX_URL to .env.local");
      process.exit(1);
    }

    console.log(
      colors.green(`\nDeploying with ${env.BACKEND_MODE} backend...\n`),
    );

    console.log(colors.cyan("Deploying API worker..."));
    const apiDeploy = await runProcess(
      ["bun", "run", `deploy:${env.BACKEND_MODE}`],
      {
        cwd: resolve(ROOT_DIR, "api"),
      },
    );
    await apiDeploy.exited;

    if (!env.DEPLOY_SITE_URL) {
      console.error(colors.red("DEPLOY_SITE_URL is required for deployment"));
      console.log("Set it in .env.local to your Cloudflare Pages URL");
      process.exit(1);
    }

    await syncConvexEnvProd(env, env.DEPLOY_SITE_URL);

    console.log(colors.cyan("\nBuilding frontend..."));
    if (!env.DEPLOY_API_URL) {
      console.error(colors.red("DEPLOY_API_URL is required for deployment"));
      console.log("Set it in .env.local to your deployed API URL");
      process.exit(1);
    }

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
  },
};

const secretsCommand: Command = {
  name: "secrets",
  description: "Push secrets to Cloudflare Workers",
  async execute(env: Env): Promise<void> {
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
  },
};

// =============================================================================
// Registry
// =============================================================================

const commands: Command[] = [devCommand, deployCommand, secretsCommand];
