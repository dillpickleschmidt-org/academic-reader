import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { createTTSBackend } from "../backends/tts/factory"

interface TTSSynthesizeRequest {
  documentId: string
  blockId: string
  voiceId?: string
}

export const tts = new Hono()

tts.use("/tts", requireAuth)

tts.post("/tts", async (c) => {
  const event = c.get("event")

  // Create authenticated Convex client
  const convex = await createAuthenticatedConvexClient(c.req.raw.headers)
  if (!convex) {
    event.error = {
      category: "auth",
      message: "Failed to authenticate with Convex",
      code: "CONVEX_AUTH_ERROR",
    }
    return c.json({ error: "Authentication failed" }, 401)
  }

  const bodyResult = await tryCatch(c.req.json<TTSSynthesizeRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const { documentId, blockId, voiceId = "male_1" } = bodyResult.data

  if (!documentId || !blockId) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId",
      code: "MISSING_FIELDS",
    }
    return c.json({ error: "Missing required fields" }, 400)
  }

  // Get reworded text from cache
  const cacheResult = await tryCatch(
    convex.query(api.api.tts.get, {
      documentId: documentId as Id<"documents">,
      blockId,
    }),
  )

  if (!cacheResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(cacheResult.error),
      code: "CACHE_QUERY_ERROR",
    }
    return c.json({ error: "Failed to query TTS cache" }, 500)
  }

  if (!cacheResult.data) {
    event.error = {
      category: "validation",
      message:
        "No reworded text found for this block. Call /api/tts/rewrite first.",
      code: "NO_REWORDED_TEXT",
    }
    return c.json(
      { error: "No reworded text found. Rewrite the text first." },
      404,
    )
  }

  const text = cacheResult.data.rewordedText

  // Create TTS backend
  let backend
  try {
    backend = createTTSBackend()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "TTS_BACKEND_CONFIG_ERROR",
    }
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  // Synthesize speech
  const synthesizeStart = performance.now()

  const synthesizeResult = await tryCatch(backend.synthesize({ text, voiceId }))

  if (!synthesizeResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(synthesizeResult.error),
      code: "TTS_SYNTHESIZE_ERROR",
    }
    return c.json({ error: "Failed to synthesize speech" }, 500)
  }

  const { audio, sampleRate, durationMs } = synthesizeResult.data
  const synthesizeDurationMs = Math.round(performance.now() - synthesizeStart)

  event.metadata = {
    blockId,
    voiceId,
    audioDurationMs: durationMs,
    synthesizeDurationMs,
  }

  return c.json({
    audio,
    sampleRate,
    durationMs,
  })
})

// Endpoint to list available voices
tts.get("/tts/voices", async (c) => {
  const event = c.get("event")

  let backend
  try {
    backend = createTTSBackend()
  } catch (error) {
    event.error = {
      category: "configuration",
      message: getErrorMessage(error),
      code: "TTS_BACKEND_CONFIG_ERROR",
    }
    return c.json({ error: "TTS backend configuration error" }, 500)
  }

  const voicesResult = await tryCatch(backend.listVoices())

  if (!voicesResult.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(voicesResult.error),
      code: "TTS_VOICES_ERROR",
    }
    return c.json({ error: "Failed to list voices" }, 500)
  }

  return c.json({ voices: voicesResult.data })
})
