import { Hono } from "hono"
import type { Id } from "@repo/convex/convex/_generated/dataModel"
import { api } from "@repo/convex/convex/_generated/api"
import type { Storage } from "../storage/types"
import { createAuthenticatedConvexClient } from "../services/convex"
import { requireAuth } from "../middleware/auth"
import { tryCatch, getErrorMessage } from "../utils/try-catch"
import { createTTSBackend } from "../backends/tts/factory"

interface TTSSegmentRequest {
  documentId: string
  blockId: string
  variation?: string
  segmentIndex: number
  voiceId?: string
}

/** Segment data returned from Convex query */
interface SegmentData {
  index: number
  text: string
}

type Variables = {
  storage: Storage
  userId: string
}

export const tts = new Hono<{ Variables: Variables }>()

tts.use("/tts/*", requireAuth)

/**
 * Synthesize audio for a single segment.
 * Returns presigned S3 URL if audio exists or after generating.
 */
tts.post("/tts/segment", async (c) => {
  const event = c.get("event")
  const storage = c.get("storage")
  const userId = c.get("userId")

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

  const bodyResult = await tryCatch(c.req.json<TTSSegmentRequest>())
  if (!bodyResult.success) {
    event.error = {
      category: "validation",
      message: getErrorMessage(bodyResult.error),
      code: "JSON_PARSE_ERROR",
    }
    return c.json({ error: "Invalid request body" }, 400)
  }

  const {
    documentId,
    blockId,
    variation = "default",
    segmentIndex,
    voiceId = "male_1",
  } = bodyResult.data

  if (!documentId || !blockId || segmentIndex === undefined) {
    event.error = {
      category: "validation",
      message: "Missing required fields: documentId, blockId, segmentIndex",
      code: "MISSING_FIELDS",
    }
    return c.json({ error: "Missing required fields" }, 400)
  }

  // Check if audio already exists
  const existingAudio = await tryCatch(
    convex.query(api.api.ttsSegments.getAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
      segmentIndex,
      voiceId,
    }),
  )

  if (existingAudio.success && existingAudio.data) {
    // Audio exists - return presigned URL
    const audioUrl = await storage.getFileUrl(existingAudio.data.storagePath)
    event.metadata = {
      cached: true,
      blockId,
      segmentIndex,
      voiceId,
    }
    return c.json({
      audioUrl,
      durationMs: existingAudio.data.durationMs,
      sampleRate: existingAudio.data.sampleRate,
      cached: true,
    })
  }

  // Get segment text from Convex
  const segments = await tryCatch(
    convex.query(api.api.ttsSegments.getSegments, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
    }),
  )

  if (!segments.success) {
    event.error = {
      category: "backend",
      message: getErrorMessage(segments.error),
      code: "SEGMENTS_QUERY_ERROR",
    }
    return c.json({ error: "Failed to query segments" }, 500)
  }

  const segment = segments.data.find(
    (s: SegmentData) => s.index === segmentIndex,
  )
  if (!segment) {
    event.error = {
      category: "validation",
      message: `Segment ${segmentIndex} not found. Call /api/tts/rewrite first.`,
      code: "SEGMENT_NOT_FOUND",
    }
    return c.json({ error: "Segment not found" }, 404)
  }

  // Get document to find storageId
  const doc = await tryCatch(
    convex.query(api.api.documents.get, {
      documentId: documentId as Id<"documents">,
    }),
  )

  if (!doc.success || !doc.data) {
    event.error = {
      category: "validation",
      message: "Document not found",
      code: "DOCUMENT_NOT_FOUND",
    }
    return c.json({ error: "Document not found" }, 404)
  }

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

  const synthesizeResult = await tryCatch(
    backend.synthesize({ text: segment.text, voiceId }),
  )

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

  // Save audio to S3 (sanitize blockId to be S3-safe)
  const safeBlockId = blockId.replace(/\//g, "_")
  const storagePath = `documents/${userId}/${doc.data.storageId}/audio/${variation}/${voiceId}/${safeBlockId}-${segmentIndex}.wav`

  // Convert base64 to buffer and save with proper content type
  const audioBuffer = Buffer.from(audio, "base64")
  const saveResult = await tryCatch(
    storage.saveFile(storagePath, audioBuffer, { contentType: "audio/wav" }),
  )

  if (!saveResult.success) {
    event.error = {
      category: "storage",
      message: getErrorMessage(saveResult.error),
      code: "S3_SAVE_ERROR",
    }
    return c.json({ error: "Failed to save audio" }, 500)
  }

  // Create audio record in Convex
  const createAudioResult = await tryCatch(
    convex.mutation(api.api.ttsSegments.createAudio, {
      documentId: documentId as Id<"documents">,
      blockId,
      variation,
      segmentIndex,
      voiceId,
      storagePath,
      durationMs,
      sampleRate,
    }),
  )

  if (!createAudioResult.success) {
    console.error("Failed to create audio record:", createAudioResult.error)
  }

  // Get presigned URL for the saved file
  const audioUrl = await storage.getFileUrl(storagePath)

  event.metadata = {
    cached: false,
    blockId,
    segmentIndex,
    voiceId,
    audioDurationMs: durationMs,
    synthesizeDurationMs,
  }

  return c.json({
    audioUrl,
    durationMs,
    sampleRate,
    cached: false,
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
