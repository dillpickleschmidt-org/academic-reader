import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { ValidationError } from "@academic-reader/api-client/errors"
import {
  GenerateDocumentAudioRequest,
  GetBlockAudioRequest,
  getVoice,
} from "@academic-reader/api-client/schemas/tts"
import { requireAuth } from "../middleware/auth"
import { getEvent } from "../middleware/wide-event"
import { Storage } from "../services/storage"
import { ConvexClient } from "../services/convex-client"
import { TtsService } from "../services/backends/tts"
import { AppConfig } from "../config"
import { startDocumentAudioGeneration } from "../services/tts-generation"
import { audioUrl } from "../documents/document-storage"
import { decodeJsonBody } from "./request-body"

export const ttsRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    "/get-block-audio",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()

      if (config.ttsBackend === "none") {
        return HttpServerResponse.unsafeJson(
          { error: "TTS is disabled" },
          { status: 404 },
        )
      }

      const { documentId, blockId, voiceId } = yield* decodeJsonBody(
        GetBlockAudioRequest,
      )

      if (!getVoice(voiceId)) {
        return yield* new ValidationError({
          message: `Unknown voice: ${voiceId}`,
        })
      }

      const cachedAudio = yield* Effect.tryPromise({
        try: () => convex.getBlockAudio(documentId, blockId, voiceId),
        catch: (e) => e as Error,
      })

      if (!cachedAudio) {
        return HttpServerResponse.unsafeJson({ ready: false })
      }

      return HttpServerResponse.unsafeJson({
        ready: true,
        audioUrl: audioUrl(documentId, blockId, voiceId),
        text: cachedAudio.text,
        durationMs: cachedAudio.durationMs,
        sampleRate: cachedAudio.sampleRate,
        wordTimestamps: cachedAudio.wordTimestamps,
      })
    }),
  ),

  HttpRouter.post(
    "/generate-document-audio",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const event = yield* getEvent

      if (config.ttsBackend === "none") {
        return HttpServerResponse.unsafeJson(
          { error: "TTS is disabled" },
          { status: 404 },
        )
      }

      const { documentId, voiceId } = yield* decodeJsonBody(
        GenerateDocumentAudioRequest,
      )

      if (!getVoice(voiceId)) {
        return yield* new ValidationError({
          message: `Unknown voice: ${voiceId}`,
        })
      }

      const readiness = yield* Effect.tryPromise({
        try: () => convex.getDocumentAudioReadiness(documentId),
        catch: (e) => e as Error,
      })

      if (!readiness.ttsReady) {
        return HttpServerResponse.unsafeJson(
          { error: "TTS text is not ready yet" },
          { status: 409 },
        )
      }

      if (
        readiness.totalEligibleBlocks > 0 &&
        readiness.voices[voiceId].audioBlockIds.length ===
          readiness.totalEligibleBlocks
      ) {
        return HttpServerResponse.unsafeJson({
          started: false,
          reason: "complete",
        })
      }

      const result = startDocumentAudioGeneration({
        convex: convexService.server(),
        storage,
        ttsService,
        documentId,
        voiceId,
        ttsBackend: config.ttsBackend,
        event: {
          ...event,
          timestamp: new Date().toISOString(),
          method: "BACKGROUND",
          path: "/tts/generate-document-audio/background",
          startTimeMs: performance.now(),
          documentId,
          voiceId,
          ttsBackend: config.ttsBackend,
        },
      })

      return HttpServerResponse.unsafeJson(result)
    }),
  ),

  HttpRouter.post(
    "/unload",
    Effect.gen(function* () {
      yield* requireAuth
      const config = yield* AppConfig
      const isProduction =
        config.environment === "prod" || config.environment === "production"

      if (config.ttsBackend !== "local" || isProduction) {
        return HttpServerResponse.unsafeJson(
          { error: "TTS unload is only available in local development" },
          { status: 404 },
        )
      }

      const ttsService = yield* TtsService
      const results: Record<string, boolean> = {}
      for (const engine of ["qwen3", "kokoro"] as const) {
        const result = yield* ttsService.unloadWorker(engine).pipe(Effect.either)
        results[engine] = result._tag === "Right"
      }

      return HttpServerResponse.unsafeJson({ unloaded: results })
    }),
  ),
)
