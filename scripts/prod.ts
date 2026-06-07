import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs"
import { randomBytes } from "crypto"
import { resolve } from "path"

const root = resolve(import.meta.dirname, "..")
const envPath = resolve(root, ".env.production")
const generatedDir = resolve(root, ".infra/generated")
const action = process.argv[2] ?? "print"
const revealSecrets = process.argv.includes("--reveal-secrets")

switch (action) {
  case "setup":
    await setup()
    break
  case "up":
    await up()
    break
  case "down":
    await down()
    break
  case "sync-convex":
    await syncConvex()
    break
  case "print":
    assertEnvFile()
    printReport(parseEnvFile(envPath), revealSecrets)
    break
  case "doctor":
    await doctor()
    break
  default:
    console.error(`Unknown prod action: ${action}`)
    process.exit(1)
}

async function setup() {
  const existing = parseEnvFile(envPath)
  const domain = await ask(
    "Primary domain",
    existing.PROD_DOMAIN || existing.APP_DOMAIN || "example.com",
  )
  const appDomain = domain
  const convexDomain = await ask(
    "Convex API domain",
    existing.CONVEX_DOMAIN || `convex.${domain}`,
  )
  const storageBackend = await askChoice(
    "Storage backend",
    ["minio", "r2"],
    existing.STORAGE_BACKEND || "minio",
  )
  const filesDomain =
    storageBackend === "minio"
      ? await ask("Files domain", existing.FILES_DOMAIN || `files.${domain}`)
      : existing.FILES_DOMAIN || ""
  const conversionBackend = await askChoice(
    "Conversion backend",
    ["datalab", "modal"],
    existing.CONVERSION_BACKEND || "datalab",
  )
  const ttsBackend = await askChoice(
    "TTS backend",
    ["none", "modal"],
    existing.TTS_BACKEND || "none",
  )

  const s3Bucket = existing.S3_BUCKET || "academic-reader"
  const r2ApiEndpoint =
    storageBackend === "r2"
      ? await ask(
          "R2 S3 API endpoint",
          existing.S3_API_ENDPOINT ||
            "https://<account-id>.r2.cloudflarestorage.com",
        )
      : ""
  const r2PresignedUrlEndpoint =
    storageBackend === "r2"
      ? await ask(
          "R2 presigned URL endpoint",
          existing.S3_PRESIGNED_URL_ENDPOINT || r2ApiEndpoint,
        )
      : ""
  const minioRootUser =
    existing.MINIO_ROOT_USER || `academic-${randomBytes(6).toString("hex")}`
  const minioRootPassword =
    existing.MINIO_ROOT_PASSWORD || randomBytes(32).toString("hex")

  const next = {
    ...existing,
    PROD_DOMAIN: domain,
    APP_DOMAIN: appDomain,
    CONVEX_DOMAIN: convexDomain,
    FILES_DOMAIN: filesDomain,
    SITE_URL: `https://${appDomain}`,
    PUBLIC_CONVEX_API_URL: `https://${convexDomain}`,
    CONVEX_API_URL: "http://convex-backend:3210",
    CONVEX_HTTP_ACTIONS_URL: "http://convex-backend:3211",
    CONVERSION_BACKEND: conversionBackend,
    TTS_BACKEND: ttsBackend,
    STORAGE_BACKEND: storageBackend,
    BETTER_AUTH_SECRET:
      existing.BETTER_AUTH_SECRET || randomBytes(32).toString("hex"),
    API_TO_CONVEX_SERVICE_SECRET:
      existing.API_TO_CONVEX_SERVICE_SECRET || randomBytes(32).toString("hex"),
    MINIO_ROOT_USER: minioRootUser,
    MINIO_ROOT_PASSWORD: minioRootPassword,
    S3_API_ENDPOINT:
      storageBackend === "minio" ? "http://minio:9000" : r2ApiEndpoint,
    S3_PRESIGNED_URL_ENDPOINT:
      storageBackend === "minio"
        ? `https://${filesDomain}`
        : r2PresignedUrlEndpoint,
    S3_ACCESS_KEY:
      existing.S3_ACCESS_KEY || (storageBackend === "minio" ? minioRootUser : ""),
    S3_SECRET_KEY:
      existing.S3_SECRET_KEY ||
      (storageBackend === "minio" ? minioRootPassword : ""),
    S3_BUCKET: s3Bucket,
    GOOGLE_API_KEY: existing.GOOGLE_API_KEY || "",
    DATALAB_API_KEY: existing.DATALAB_API_KEY || "",
    MODAL_MARKER_URL: existing.MODAL_MARKER_URL || "",
    MODAL_LIGHTONOCR_URL: existing.MODAL_LIGHTONOCR_URL || "",
    MODAL_CHANDRA_URL: existing.MODAL_CHANDRA_URL || "",
    MODAL_KOKORO_TTS_URL: existing.MODAL_KOKORO_TTS_URL || "",
    MODAL_QWEN3_TTS_URL: existing.MODAL_QWEN3_TTS_URL || "",
    GOOGLE_CLIENT_ID: existing.GOOGLE_CLIENT_ID || "",
    GOOGLE_CLIENT_SECRET: existing.GOOGLE_CLIENT_SECRET || "",
    EXA_API_KEY: existing.EXA_API_KEY || "",
    GROQ_API_KEY: existing.GROQ_API_KEY || "",
    OPENROUTER_API_KEY: existing.OPENROUTER_API_KEY || "",
    CHAT_PROVIDER: existing.CHAT_PROVIDER || "groq",
    CHAT_MODEL: existing.CHAT_MODEL || "openai/gpt-oss-120b",
    PROCESSING_PROVIDER: existing.PROCESSING_PROVIDER || "groq",
    PROCESSING_MODEL: existing.PROCESSING_MODEL || "openai/gpt-oss-120b",
    SUMMARY_PROVIDER: existing.SUMMARY_PROVIDER || "groq",
    SUMMARY_MODEL: existing.SUMMARY_MODEL || "openai/gpt-oss-120b",
    OTEL_EXPORTER_OTLP_ENDPOINT: existing.OTEL_EXPORTER_OTLP_ENDPOINT || "",
  }

  writeEnvFile(next)
  writeCaddyfile(next)
  writeReport(next)
  printReport(next, revealSecrets)
  printMissingDashboardValues(next)
}

async function up() {
  assertEnvFile()
  const env = parseEnvFile(envPath)
  writeCaddyfile(env)
  await run("docker", [...composeArgs(env), "up", "-d", "--build"])
  await syncConvex()
  await doctor()
}

async function down() {
  assertEnvFile()
  await run(
    "docker",
    [...composeArgs({ ...parseEnvFile(envPath), STORAGE_BACKEND: "minio" }), "down"],
  )
}

async function syncConvex() {
  assertEnvFile()
  const env = parseEnvFile(envPath)

  await run("docker", [...composeArgs(env), "up", "-d", "convex-backend"])
  await waitForUrl("http://127.0.0.1:3210/version", 60_000)

  const adminKey = await ensureConvexAdminKey(env)
  const convexEnv = {
    ...process.env,
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
  }
  const convexCwd = resolve(root, "packages/convex")

  await run("bunx", ["convex", "deploy", "--yes"], {
    cwd: convexCwd,
    env: convexEnv,
  })

  for (const key of [
    "SITE_URL",
    "BETTER_AUTH_SECRET",
    "API_TO_CONVEX_SERVICE_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ]) {
    const value = parseEnvFile(envPath)[key]
    if (!value) continue
    await run("bunx", ["convex", "env", "set", key, value], {
      cwd: convexCwd,
      env: convexEnv,
    })
  }
}

async function doctor() {
  assertEnvFile()
  const env = parseEnvFile(envPath)
  printMissingDashboardValues(env)

  for (const [label, url] of [
    ["app", env.SITE_URL],
    ["convex", env.PUBLIC_CONVEX_API_URL],
    ["local convex", "http://127.0.0.1:3210/version"],
  ] as const) {
    if (!url) continue
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      console.log(`[prod:doctor] ${label}: ${response.status}`)
    } catch {
      console.log(`[prod:doctor] ${label}: unavailable`)
    }
  }
}

async function ensureConvexAdminKey(env: Record<string, string>) {
  if (env.CONVEX_SELF_HOSTED_ADMIN_KEY) return env.CONVEX_SELF_HOSTED_ADMIN_KEY

  const proc = Bun.spawn(
    [
      "docker",
      ...composeArgs(env),
      "exec",
      "-T",
      "convex-backend",
      "./generate_admin_key.sh",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  if (proc.exitCode !== 0) {
    throw new Error(`Could not generate Convex admin key: ${stderr.trim()}`)
  }

  const match = output.match(/(convex-self-hosted\|\S+)/)
  if (!match) throw new Error("Could not parse Convex admin key")

  const next = { ...env, CONVEX_SELF_HOSTED_ADMIN_KEY: match[1] }
  writeEnvFile(next)
  console.log("[prod] Added CONVEX_SELF_HOSTED_ADMIN_KEY to .env.production")
  return match[1]
}

function composeArgs(env = parseEnvFile(envPath)) {
  return [
    "compose",
    ...(env.STORAGE_BACKEND === "minio" ? ["--profile", "minio"] : []),
    "--env-file",
    envPath,
    "-f",
    "docker-compose.prod.yml",
  ]
}

function writeCaddyfile(env: Record<string, string>) {
  mkdirSync(generatedDir, { recursive: true })
  const fileSite =
    env.STORAGE_BACKEND === "minio" && env.FILES_DOMAIN
      ? `\n\n${env.FILES_DOMAIN} {\n  encode zstd gzip\n  reverse_proxy minio:9000\n}\n`
      : "\n"

  writeFileSync(
    resolve(generatedDir, "Caddyfile"),
    `${env.APP_DOMAIN} {\n  encode zstd gzip\n\n  reverse_proxy /api/auth* convex-backend:3211\n  reverse_proxy app:8787\n}\n\n${env.CONVEX_DOMAIN} {\n  encode zstd gzip\n  reverse_proxy convex-backend:3210\n}${fileSite}`,
  )
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

function writeEnvFile(env: Record<string, string>) {
  const sections: Array<[string, string[]]> = [
    [
      "Deployment",
      [
        "PROD_DOMAIN",
        "APP_DOMAIN",
        "CONVEX_DOMAIN",
        "FILES_DOMAIN",
        "SITE_URL",
        "PUBLIC_CONVEX_API_URL",
      ],
    ],
    [
      "Backends",
      [
        "CONVERSION_BACKEND",
        "TTS_BACKEND",
        "STORAGE_BACKEND",
        "CONVEX_API_URL",
        "CONVEX_HTTP_ACTIONS_URL",
      ],
    ],
    [
      "Generated secrets",
      [
        "BETTER_AUTH_SECRET",
        "API_TO_CONVEX_SERVICE_SECRET",
        "CONVEX_SELF_HOSTED_ADMIN_KEY",
      ],
    ],
    [
      "MinIO / S3",
      [
        "MINIO_ROOT_USER",
        "MINIO_ROOT_PASSWORD",
        "S3_API_ENDPOINT",
        "S3_PRESIGNED_URL_ENDPOINT",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "S3_BUCKET",
      ],
    ],
    [
      "Dashboard-provided keys",
      [
        "GOOGLE_API_KEY",
        "DATALAB_API_KEY",
        "MODAL_MARKER_URL",
        "MODAL_LIGHTONOCR_URL",
        "MODAL_CHANDRA_URL",
        "MODAL_KOKORO_TTS_URL",
        "MODAL_QWEN3_TTS_URL",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "EXA_API_KEY",
        "GROQ_API_KEY",
        "OPENROUTER_API_KEY",
      ],
    ],
    [
      "Models",
      [
        "CHAT_PROVIDER",
        "CHAT_MODEL",
        "PROCESSING_PROVIDER",
        "PROCESSING_MODEL",
        "SUMMARY_PROVIDER",
        "SUMMARY_MODEL",
      ],
    ],
    ["Observability", ["OTEL_EXPORTER_OTLP_ENDPOINT"]],
  ]

  const lines: string[] = []
  for (const [title, keys] of sections) {
    lines.push(`# ${title}`)
    for (const key of keys) {
      const value = env[key]
      if (value !== undefined) lines.push(`${key}=${value}`)
    }
    lines.push("")
  }

  writeFileSync(envPath, `${lines.join("\n").trim()}\n`)
}

function writeReport(env: Record<string, string>) {
  mkdirSync(generatedDir, { recursive: true })
  writeFileSync(resolve(generatedDir, "production.md"), report(env, false))
}

function printReport(env: Record<string, string>, reveal: boolean) {
  console.log(report(env, reveal))
}

function report(env: Record<string, string>, reveal: boolean) {
  const maskedEnv = Object.entries(env)
    .map(([key, value]) => `${key}=${maskValue(key, value, reveal)}`)
    .join("\n")
  const filesDns =
    env.STORAGE_BACKEND === "minio" && env.FILES_DOMAIN
      ? `\nA    ${env.FILES_DOMAIN}     <VPS_IP>`
      : ""
  const filesUrl =
    env.STORAGE_BACKEND === "minio" && env.FILES_DOMAIN
      ? `\nFiles:     https://${env.FILES_DOMAIN}`
      : ""

  return `# Academic Reader production setup

## DNS records

A    ${env.APP_DOMAIN || "<app-domain>"}       <VPS_IP>
A    ${env.CONVEX_DOMAIN || "<convex-domain>"}    <VPS_IP>${filesDns}

## URLs

App:       ${env.SITE_URL || ""}
Convex:    ${env.PUBLIC_CONVEX_API_URL || ""}${filesUrl}
Dashboard: ssh -L 6791:localhost:6791 <user>@<VPS_IP>

## Commands

bun run prod:up
bun run prod:doctor
bun run prod:print -- --reveal-secrets

## .env.production

\`\`\`
${maskedEnv}
\`\`\`
`
}

function printMissingDashboardValues(env: Record<string, string>) {
  const required = ["GOOGLE_API_KEY"]
  if (env.STORAGE_BACKEND === "r2") {
    required.push(
      "S3_API_ENDPOINT",
      "S3_PRESIGNED_URL_ENDPOINT",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "S3_BUCKET",
    )
  }
  if (env.CONVERSION_BACKEND === "datalab") required.push("DATALAB_API_KEY")
  if (env.CONVERSION_BACKEND === "modal") required.push("MODAL_MARKER_URL")
  if (env.TTS_BACKEND === "modal") {
    required.push("MODAL_KOKORO_TTS_URL", "MODAL_QWEN3_TTS_URL")
  }

  const missing = required.filter(
    (key) => !env[key] || env[key].includes("<"),
  )
  const oauthIncomplete =
    (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) ||
    (!env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

  if (!missing.length && !oauthIncomplete) return

  console.log("\nMissing dashboard-provided values:")
  for (const key of missing) console.log(`  - ${key}`)
  if (oauthIncomplete) {
    console.log("  - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together")
  }
}

function maskValue(key: string, value: string, reveal: boolean) {
  if (reveal || !isSecretKey(key) || !value) return value
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function isSecretKey(key: string) {
  return /SECRET|KEY|TOKEN|PASSWORD/.test(key)
}

async function ask(label: string, defaultValue: string) {
  const suffix = defaultValue ? ` [${defaultValue}]` : ""
  const answer = prompt(`${label}${suffix}:`)?.trim()
  return answer || defaultValue
}

async function askChoice(
  label: string,
  choices: string[],
  defaultValue: string,
) {
  const value = await ask(`${label} (${choices.join("/")})`, defaultValue)
  return choices.includes(value) ? value : defaultValue
}

async function run(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
) {
  console.log(`[prod] ${command} ${args.join(" ")}`)
  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd ?? root,
    env: options?.env ?? process.env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  const code = await proc.exited
  if (code !== 0) process.exit(code)
}

async function waitForUrl(url: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await Bun.sleep(1000)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function assertEnvFile() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.production. Run bun run setup:prod first.")
    process.exit(1)
  }
}
