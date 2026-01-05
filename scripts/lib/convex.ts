import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawn } from "bun";
import type { Env } from "./types";
import { ROOT_DIR, ENV_FILE, colors, getSystemEnv } from "./utils";

// =============================================================================
// Public API
// =============================================================================

export function getConvexEnv(adminKey: string): Record<string, string> {
  return {
    CONVEX_SELF_HOSTED_URL: "http://localhost:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  };
}

export async function generateConvexAdminKey(
  profileArgs: string[],
): Promise<string | null> {
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

  const match = output.match(/(convex-self-hosted\|\S+)/);
  if (!match) {
    console.error(colors.red("Could not parse admin key from output:"));
    console.error(output || "(empty output)");
    return null;
  }

  const adminKey = match[1];

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

async function setConvexEnvVars(
  vars: Record<string, string | undefined>,
  processEnv: Record<string, string>,
): Promise<void> {
  const varsToSet = Object.entries(vars).filter(([, v]) => v !== undefined);
  if (varsToSet.length === 0) return;

  console.log(colors.cyan("Syncing Convex environment variables..."));

  for (const [key, value] of varsToSet) {
    const proc = spawn({
      cmd: ["bunx", "convex", "env", "set", key, value!],
      cwd: resolve(ROOT_DIR, "frontend"),
      env: processEnv,
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

export async function syncConvexEnvDev(env: Env): Promise<void> {
  await setConvexEnvVars(
    {
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    },
    { ...getSystemEnv(), ...getConvexEnv(env.CONVEX_SELF_HOSTED_ADMIN_KEY!) },
  );
}

export async function syncConvexEnvProd(
  env: Env,
  siteUrl: string,
): Promise<void> {
  await setConvexEnvVars(
    {
      SITE_URL: siteUrl,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    },
    {
      ...getSystemEnv(),
      CONVEX_DEPLOYMENT: env.CONVEX_DEPLOYMENT!,
    },
  );
}
