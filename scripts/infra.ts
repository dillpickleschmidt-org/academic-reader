import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");

let backendMode = "modal";
try {
  const envContent = readFileSync(envPath, "utf-8");
  const match = envContent.match(/^BACKEND_MODE\s*=\s*(.+)$/m);
  if (match) backendMode = match[1].trim();
} catch {
  console.warn("No .env.local found, defaulting to BACKEND_MODE=modal");
}

const action = process.argv[2] ?? "up";
const args =
  action === "down"
    ? ["compose", "--profile", backendMode, "down"]
    : ["compose", "--profile", backendMode, "up", "-d"];

console.log(`[infra] BACKEND_MODE=${backendMode} → docker ${args.join(" ")}`);

const proc = Bun.spawn(["docker", ...args], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});

const code = await proc.exited;
if (code !== 0) process.exit(code);

if (action === "down") process.exit(0);

const adminKey = await generateConvexAdminKey();
if (adminKey) await syncConvexEnvVars(adminKey);
process.exit(0);

function parseEnvFile(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (match) vars[match[1]] = match[2].trim();
    }
    return vars;
  } catch {
    return {};
  }
}

async function generateConvexAdminKey(): Promise<string | null> {
  const convexEnvPath = resolve(root, "packages/convex/.env.local");
  const convexUrl = "http://localhost:3210";

  const keyProc = Bun.spawn(
    [
      "docker",
      "compose",
      "--profile",
      backendMode,
      "exec",
      "convex-backend",
      "./generate_admin_key.sh",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );

  const output = await new Response(keyProc.stdout).text();
  await keyProc.exited;

  if (keyProc.exitCode !== 0) {
    console.warn(
      "[infra] Could not generate Convex admin key (is convex-backend running?)",
    );
    return null;
  }

  const match = output.match(/(convex-self-hosted\|\S+)/);
  if (!match) {
    console.warn("[infra] Could not parse admin key from output");
    return null;
  }

  const adminKey = match[1];

  writeFileSync(
    convexEnvPath,
    `CONVEX_SELF_HOSTED_URL=${convexUrl}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`,
  );
  console.log("[infra] Generated packages/convex/.env.local");

  try {
    const rootEnv = readFileSync(envPath, "utf-8");
    const updated = rootEnv.replace(
      /^CONVEX_SELF_HOSTED_ADMIN_KEY=.+$/m,
      `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`,
    );
    if (updated !== rootEnv) {
      writeFileSync(envPath, updated);
      console.log("[infra] Updated admin key in .env.local");
    }
  } catch {}

  return adminKey;
}

async function syncConvexEnvVars(adminKey: string) {
  const env = parseEnvFile(envPath);
  const convexEnv = {
    CONVEX_SELF_HOSTED_URL: "http://localhost:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  };
  const convexCwd = resolve(root, "packages/convex");

  const keysToSync = [
    "SITE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "BETTER_AUTH_SECRET",
  ];

  console.log("[infra] Syncing Convex environment variables...");

  for (const key of keysToSync) {
    const value = env[key];
    if (!value) continue;

    const proc = Bun.spawn(["bunx", "convex", "env", "set", key, value], {
      cwd: convexCwd,
      env: { ...process.env, ...convexEnv },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode === 0) {
      console.log(`  ${key} ✓`);
    } else {
      console.log(`  ${key} (skipped) ${stderr.trim()}`);
    }
  }
}
