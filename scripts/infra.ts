import { readFileSync, writeFileSync, existsSync } from "fs"
import { randomBytes } from "crypto"
import { resolve } from "path"

const root = resolve(import.meta.dirname, "..")
const envPath = resolve(root, ".env.local")
const action = process.argv[2] ?? "up"
const env = parseEnvFile(envPath)
const conversionBackend = env.CONVERSION_BACKEND ?? "datalab"
const ttsBackend =
  env.TTS_BACKEND ?? (conversionBackend === "local" ? "local" : "none")
const composeProfile = selectComposeProfile(conversionBackend, ttsBackend)

if (action !== "down") {
  ensureGeneratedSecret("BETTER_AUTH_SECRET")
  ensureGeneratedSecret("API_TO_CONVEX_SERVICE_SECRET")
}

const args =
  action === "down"
    ? ["compose", "--profile", composeProfile, "down"]
    : ["compose", "--profile", composeProfile, "up", "-d"]

console.log(
  `[infra] CONVERSION_BACKEND=${conversionBackend} TTS_BACKEND=${ttsBackend} → docker ${args.join(" ")}`,
)

const proc = Bun.spawn(["docker", ...args], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
})

const code = await proc.exited
if (code !== 0) process.exit(code)

if (action === "down") process.exit(0)

const adminKey = await generateConvexAdminKey()
if (adminKey) await syncConvexEnvVars(adminKey)
await setupModalWorkersIfNeeded()
process.exit(0)

function selectComposeProfile(conversionBackend: string, ttsBackend: string) {
  if (conversionBackend === "local" || ttsBackend === "local") return "local"
  if (conversionBackend === "modal" || ttsBackend === "modal") return "modal"
  return "datalab"
}

function ensureGeneratedSecret(key: string) {
  if (!existsSync(envPath)) return

  const currentEnv = parseEnvFile(envPath)
  if (currentEnv[key]) return

  const secret = randomBytes(32).toString("hex")
  const envContent = readFileSync(envPath, "utf-8")
  const separator = envContent.endsWith("\n") ? "" : "\n"
  writeFileSync(envPath, `${envContent}${separator}${key}=${secret}\n`)
  console.log(`[infra] Added ${key} to .env.local`)
}

function parseEnvFile(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, "utf-8")
    const vars: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (match) vars[match[1]] = match[2].trim()
    }
    return vars
  } catch {
    return {}
  }
}

async function generateConvexAdminKey(): Promise<string | null> {
  const convexEnvPath = resolve(root, "packages/convex/.env.local")
  const convexUrl = "http://localhost:3210"

  const keyProc = Bun.spawn(
    [
      "docker",
      "compose",
      "--profile",
      composeProfile,
      "exec",
      "convex-backend",
      "./generate_admin_key.sh",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )

  const output = await new Response(keyProc.stdout).text()
  await keyProc.exited

  if (keyProc.exitCode !== 0) {
    console.warn(
      "[infra] Could not generate Convex admin key (is convex-backend running?)",
    )
    return null
  }

  const match = output.match(/(convex-self-hosted\|\S+)/)
  if (!match) {
    console.warn("[infra] Could not parse admin key from output")
    return null
  }

  const adminKey = match[1]

  writeFileSync(
    convexEnvPath,
    `CONVEX_SELF_HOSTED_URL=${convexUrl}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`,
  )
  console.log("[infra] Generated packages/convex/.env.local")

  updateEnvFile("CONVEX_SELF_HOSTED_ADMIN_KEY", adminKey)

  return adminKey
}

async function setupModalWorkersIfNeeded() {
  const currentEnv = parseEnvFile(envPath)
  const requiredKeys = [
    ...(currentEnv.CONVERSION_BACKEND === "modal"
      ? ["MODAL_MARKER_URL", "MODAL_LIGHTONOCR_URL", "MODAL_CHANDRA_URL"]
      : []),
    ...(currentEnv.TTS_BACKEND === "modal"
      ? ["MODAL_KOKORO_TTS_URL", "MODAL_QWEN3_TTS_URL"]
      : []),
  ]

  if (!requiredKeys.some((key) => !currentEnv[key])) return

  const proc = Bun.spawn(
    ["bun", "scripts/modal.ts", "setup", "--env-file", ".env.local"],
    { cwd: root, stdio: ["inherit", "inherit", "inherit"] },
  )

  const code = await proc.exited
  if (code !== 0) process.exit(code)
}

async function syncConvexEnvVars(adminKey: string) {
  const currentEnv = parseEnvFile(envPath)
  const convexEnv = {
    CONVEX_SELF_HOSTED_URL: "http://localhost:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  }
  const convexCwd = resolve(root, "packages/convex")

  const keysToSync = [
    "SITE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "BETTER_AUTH_SECRET",
    "API_TO_CONVEX_SERVICE_SECRET",
  ]

  console.log("[infra] Syncing Convex environment variables...")

  for (const key of keysToSync) {
    const value = currentEnv[key]
    if (!value) continue

    const proc = Bun.spawn(["bunx", "convex", "env", "set", key, value], {
      cwd: convexCwd,
      env: { ...process.env, ...convexEnv },
      stdout: "pipe",
      stderr: "pipe",
    })

    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    if (proc.exitCode === 0) {
      console.log(`  ${key} ✓`)
    } else {
      console.log(`  ${key} (skipped) ${stderr.trim()}`)
    }
  }
}

function updateEnvFile(key: string, value: string) {
  if (!existsSync(envPath)) return

  const envContent = readFileSync(envPath, "utf-8")
  const line = `${key}=${value}`
  if (new RegExp(`^${key}=.*$`, "m").test(envContent)) {
    writeFileSync(
      envPath,
      envContent.replace(new RegExp(`^${key}=.*$`, "m"), line),
    )
    console.log(`[infra] Updated ${key} in .env.local`)
    return
  }

  const separator = envContent.endsWith("\n") ? "" : "\n"
  writeFileSync(envPath, `${envContent}${separator}${line}\n`)
  console.log(`[infra] Added ${key} to .env.local`)
}
