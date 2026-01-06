import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawn } from "bun";
import type { Env } from "./types";
import { ROOT_DIR, DEV_ENV_FILE, colors, getSystemEnv } from "./utils";

// =============================================================================
// Public API
// =============================================================================

export function getConvexEnv(
  adminKey: string,
  url = "http://localhost:3210",
): Record<string, string> {
  return {
    CONVEX_SELF_HOSTED_URL: url,
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  };
}

export function parseAdminKey(output: string): string | null {
  const match = output.match(/(convex-self-hosted\|\S+)/);
  return match ? match[1] : null;
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

  const adminKey = parseAdminKey(output);
  if (!adminKey) {
    console.error(colors.red("Could not parse admin key from output:"));
    console.error(output || "(empty output)");
    return null;
  }

  const envContent = readFileSync(DEV_ENV_FILE, "utf-8");
  // Check for uncommented key with a value (not just a placeholder)
  const hasKey = /^CONVEX_SELF_HOSTED_ADMIN_KEY=.+/m.test(envContent);
  if (!hasKey) {
    // Replace placeholder (commented or empty) in place, or append if not found
    const placeholder = /^#?\s*CONVEX_SELF_HOSTED_ADMIN_KEY=.*$/m;
    const newContent = placeholder.test(envContent)
      ? envContent.replace(placeholder, `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`)
      : envContent.trimEnd() + `\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`;
    writeFileSync(DEV_ENV_FILE, newContent);
    console.log(colors.green("Admin key saved to .env.dev"));
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

    // Consume streams before waiting for exit to avoid deadlock
    const [stderr] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (proc.exitCode === 0) {
      console.log(`  ${key} ${colors.green("✓")}`);
    } else {
      console.log(
        `  ${key} ${colors.yellow("(skipped)")} ${stderr.trim() || ""}`,
      );
    }
  }
}

export async function syncConvexEnv(
  env: Env,
  convexEnv: Record<string, string>,
  siteUrl?: string,
): Promise<void> {
  await setConvexEnvVars(
    {
      ...(siteUrl && { SITE_URL: siteUrl }),
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    },
    { ...getSystemEnv(), ...convexEnv },
  );
}

export async function deployConvexFunctions(
  convexEnv: Record<string, string>,
): Promise<boolean> {
  console.log(colors.cyan("Deploying Convex functions..."));

  const proc = spawn({
    cmd: ["bunx", "convex", "deploy", "--yes"],
    cwd: resolve(ROOT_DIR, "frontend"),
    env: { ...getSystemEnv(), ...convexEnv },
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
  return proc.exitCode === 0;
}

