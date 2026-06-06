import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

interface ModalWorker {
  appName: string
  envKey: string
  file: string
  group: "conversion" | "tts"
}

const root = resolve(import.meta.dirname, "..")
const args = process.argv.slice(2)
const command = args[0]?.startsWith("--") ? "setup" : (args[0] ?? "setup")
const envFile = optionValue("--env-file") ?? ".env.local"
const envPath = resolve(root, envFile)
const forceDeploy = args.includes("--force")

const workers: ModalWorker[] = [
  {
    appName: "marker",
    envKey: "MODAL_MARKER_URL",
    file: "workers/marker/modal_app.py",
    group: "conversion",
  },
  {
    appName: "lightonocr",
    envKey: "MODAL_LIGHTONOCR_URL",
    file: "workers/lightonocr/modal_app.py",
    group: "conversion",
  },
  {
    appName: "chandra",
    envKey: "MODAL_CHANDRA_URL",
    file: "workers/chandra/modal_app.py",
    group: "conversion",
  },
  {
    appName: "kokoro-tts",
    envKey: "MODAL_KOKORO_TTS_URL",
    file: "workers/kokoro-tts/modal_app.py",
    group: "tts",
  },
  {
    appName: "qwen3-tts",
    envKey: "MODAL_QWEN3_TTS_URL",
    file: "workers/qwen3-tts/modal_app.py",
    group: "tts",
  },
]

if (command !== "setup" && command !== "print") {
  console.error(
    "Usage: bun scripts/modal.ts [setup|print] [--env-file PATH] [--force]",
  )
  process.exit(1)
}

if (!existsSync(envPath)) {
  console.error(`[modal] Env file not found: ${envFile}`)
  process.exit(1)
}

const env = parseEnvFile(envPath)
const selectedWorkers = selectWorkers(env)

if (!selectedWorkers.length) {
  console.log("[modal] No Modal workers required for current backend choices")
  process.exit(0)
}

const configured = configuredUrls(env, selectedWorkers)
const missingWorkers = selectedWorkers.filter((worker) => !env[worker.envKey])
const modalCommand = requireModalCommand()
const pythonCommand = requireModalPythonCommand(modalCommand[0])

requireGoogleApiKeyForMarker(env, selectedWorkers)
await assertModalAuthenticated(modalCommand)

if (command === "setup" && !forceDeploy && !missingWorkers.length) {
  printUrls(selectedWorkers, configured)
  console.log("[modal] All required Modal URLs are already configured")
  process.exit(0)
}

const discovered = await discoverUrls(selectedWorkers, pythonCommand)

if (command === "print") {
  printUrls(selectedWorkers, { ...discovered, ...configured })
  process.exit(0)
}

if (selectedWorkers.some((worker) => worker.appName === "marker")) {
  await syncGoogleApiSecret(env, modalCommand)
}

const nextEnv = { ...env }
let changed = false

for (const worker of selectedWorkers) {
  if (!forceDeploy && nextEnv[worker.envKey]) continue

  const discoveredUrl = !forceDeploy ? discovered[worker.appName] : undefined
  if (discoveredUrl) {
    nextEnv[worker.envKey] = discoveredUrl
    changed = true
    continue
  }

  console.log(`[modal] Deploying ${worker.appName}...`)
  await run(modalCommand[0], [...modalCommand.slice(1), "deploy", worker.file], {
    cwd: root,
    stdio: "inherit",
  })

  const urlsAfterDeploy = await discoverUrls([worker], pythonCommand)
  const url = urlsAfterDeploy[worker.appName]
  if (!url) {
    console.error(
      `[modal] Could not determine URL for ${worker.appName} after deploy`,
    )
    process.exit(1)
  }

  nextEnv[worker.envKey] = url
  changed = true
}

if (changed) {
  writeEnvValues(envPath, nextEnv)
  console.log(`[modal] Updated ${envFile}`)
}

printUrls(selectedWorkers, {
  ...discovered,
  ...configuredUrls(nextEnv, selectedWorkers),
})
console.log("[modal] Modal setup complete")

function selectWorkers(env: Record<string, string>) {
  return workers.filter((worker) => {
    if (worker.group === "conversion") return env.CONVERSION_BACKEND === "modal"
    return env.TTS_BACKEND === "modal"
  })
}

async function syncGoogleApiSecret(
  env: Record<string, string>,
  modalCommand: string[],
) {
  const googleApiKey = requireGoogleApiKeyForMarker(env, workers)
  const dir = mkdtempSync(join(tmpdir(), "academic-reader-modal-"))
  const secretPath = join(dir, "google-api-key.json")
  writeFileSync(secretPath, JSON.stringify({ GOOGLE_API_KEY: googleApiKey }))

  try {
    await run(
      modalCommand[0],
      [
        ...modalCommand.slice(1),
        "secret",
        "create",
        "google-api-key",
        "--from-json",
        secretPath,
        "--force",
      ],
      { cwd: root, stdio: "pipe" },
    )
    console.log("[modal] Synced Modal secret google-api-key")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function discoverUrls(
  selectedWorkers: ModalWorker[],
  pythonCommand: string[],
): Promise<Record<string, string>> {
  const code = `
import json
import sys
import modal

apps = json.loads(sys.argv[1])
urls = {}
for app_name in apps:
    try:
        function = modal.Function.from_name(app_name, "api")
        url = function.get_web_url()
        if url:
            urls[app_name] = url
    except Exception:
        pass
print(json.dumps(urls))
`.trim()

  const result = await run(
    pythonCommand[0],
    [
      ...pythonCommand.slice(1),
      "-c",
      code,
      JSON.stringify(selectedWorkers.map((w) => w.appName)),
    ],
    { cwd: root, stdio: "pipe", allowFailure: true },
  )

  if (result.code !== 0) return {}

  try {
    return JSON.parse(result.stdout) as Record<string, string>
  } catch {
    return {}
  }
}

function configuredUrls(
  env: Record<string, string>,
  selectedWorkers: ModalWorker[],
) {
  return Object.fromEntries(
    selectedWorkers
      .filter((worker) => env[worker.envKey])
      .map((worker) => [worker.appName, env[worker.envKey]]),
  )
}

function printUrls(
  selectedWorkers: ModalWorker[],
  urls: Record<string, string>,
) {
  console.log("[modal] Worker URLs:")
  for (const worker of selectedWorkers) {
    const url = urls[worker.appName]
    console.log(`  ${worker.envKey}=${url || "<not deployed>"}`)
  }
}

function writeEnvValues(path: string, values: Record<string, string>) {
  const lines = readFileSync(path, "utf-8").split("\n")
  const written = new Set<string>()
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*#?\s*)([A-Z0-9_]+)\s*=.*$/)
    if (!match) return line

    const key = match[2]
    const value = values[key]
    if (value === undefined) return line

    written.add(key)
    return `${key}=${value}`
  })

  for (const [key, value] of Object.entries(values)) {
    if (written.has(key)) continue
    nextLines.push(`${key}=${value}`)
  }

  writeFileSync(path, `${nextLines.join("\n").trimEnd()}\n`)
}

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8")
  const vars: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    vars[match[1]] = match[2].trim()
  }
  return vars
}

function optionValue(name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function requireGoogleApiKeyForMarker(
  env: Record<string, string>,
  selectedWorkers: ModalWorker[],
) {
  const markerSelected = selectedWorkers.some(
    (worker) => worker.appName === "marker",
  )
  if (!markerSelected) return ""

  const googleApiKey = env.GOOGLE_API_KEY
  if (googleApiKey) return googleApiKey

  console.error(
    "[modal] GOOGLE_API_KEY is required before deploying Modal conversion workers",
  )
  process.exit(1)
}

function requireModalCommand(): string[] {
  const modalPath = commandPath("modal")
  if (modalPath) return [modalPath]

  console.error("[modal] Modal CLI is not installed")
  printModalSetupInstructions()
  process.exit(1)
}

function requireModalPythonCommand(modalPath: string): string[] {
  try {
    const firstLine = readFileSync(modalPath, "utf-8").split("\n")[0]
    const match = firstLine.match(/^#!(.+)$/)
    if (match && existsSync(match[1])) return [match[1]]
  } catch {}

  console.error(
    "[modal] Could not locate the Python interpreter used by the Modal CLI",
  )
  printModalSetupInstructions()
  process.exit(1)
}

async function assertModalAuthenticated(modalCommand: string[]) {
  const result = await run(
    modalCommand[0],
    [...modalCommand.slice(1), "token", "info"],
    { stdio: "pipe", allowFailure: true },
  )

  if (result.code === 0) return

  if (result.stderr.trim()) console.error(result.stderr.trim())
  console.error("[modal] Modal is not authenticated")
  printModalSetupInstructions()
  process.exit(1)
}

function commandPath(name: string): string | null {
  const result = Bun.spawnSync(["bash", "-lc", `command -v ${name}`], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) return null
  const path = result.stdout.toString().trim()
  return path || null
}

async function run(
  command: string,
  args: string[],
  options: {
    cwd?: string
    stdio?: "inherit" | "pipe"
    allowFailure?: boolean
  } = {},
) {
  const stdio = options.stdio ?? "inherit"
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdout: stdio === "inherit" ? "inherit" : "pipe",
    stderr: stdio === "inherit" ? "inherit" : "pipe",
  })

  const [stdout, stderr, code] = await Promise.all([
    stdio === "pipe" ? new Response(proc.stdout).text() : Promise.resolve(""),
    stdio === "pipe" ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])

  if (code !== 0 && !options.allowFailure) {
    if (stdout.trim()) console.error(stdout.trim())
    if (stderr.trim()) console.error(stderr.trim())
    process.exit(code)
  }

  return { code, stdout, stderr }
}

function printModalSetupInstructions() {
  console.error(
    "[modal] Install and authenticate Modal, then rerun this command:",
  )
  console.error("  python -m pip install modal")
  console.error("  modal setup")
  console.error(`  bun scripts/modal.ts setup --env-file ${envFile}`)
}
