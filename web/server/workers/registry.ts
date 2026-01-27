/**
 * Worker Registry
 *
 * Single source of truth for GPU workers. Use activateWorker() to
 * ensure only one model is loaded at a time on a single GPU.
 */

import { env } from "../env"

export const WORKERS = {
  marker: { url: "http://marker:8000", category: "conversion" },
  chatterbox: { url: env.CHATTERBOX_TTS_WORKER_URL, category: "tts" },
  qwen3: { url: env.QWEN3_TTS_WORKER_URL, category: "tts" },
} as const

export type WorkerName = keyof typeof WORKERS

/**
 * Activate a worker, unloading all others first.
 *
 * - Unloads all workers except target (parallel, fire-and-forget)
 * - Loads target (blocks until ready)
 * - Idempotent: instant return if target already loaded
 * - Only applies to local mode
 */
export async function activateWorker(worker: WorkerName): Promise<void> {
  if (env.BACKEND_MODE !== "local") return

  const targetUrl = WORKERS[worker].url

  // Unload all except target (parallel, fire-and-forget)
  await Promise.all(
    Object.entries(WORKERS)
      .filter(([name]) => name !== worker)
      .map(([, { url }]) =>
        fetch(`${url}/unload`, { method: "POST" }).catch(() => {}),
      ),
  )

  // Load target (blocks until ready, instant if already loaded)
  const resp = await fetch(`${targetUrl}/load`, { method: "POST" })
  if (!resp.ok) {
    throw new Error(`Failed to load ${worker}: ${resp.status}`)
  }
}
