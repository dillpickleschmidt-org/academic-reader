import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
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

export const ttsRouter = HttpRouter.addAll([
  HttpRouter.route(
    "POST",
    "/api/tts/get-block-audio",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()

      if (config.ttsBackend === "none") {
        return HttpServerResponse.jsonUnsafe(
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
        return HttpServerResponse.jsonUnsafe({ ready: false })
      }

      return HttpServerResponse.jsonUnsafe({
        ready: true,
        audioUrl: audioUrl(documentId, blockId, voiceId),
        text: cachedAudio.text,
        durationMs: cachedAudio.durationMs,
        sampleRate: cachedAudio.sampleRate,
        wordTimestamps: cachedAudio.wordTimestamps,
      })
    }),
  ),

  HttpRouter.route(
    "POST",
    "/api/tts/generate-document-audio",
    Effect.gen(function* () {
      const config = yield* AppConfig
      const storage = yield* Storage
      const ttsService = yield* TtsService
      const convexService = yield* ConvexClient
      const convex = yield* convexService.userSession()
      const event = yield* getEvent

      if (config.ttsBackend === "none") {
        return HttpServerResponse.jsonUnsafe(
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
        return HttpServerResponse.jsonUnsafe(
          { error: "TTS text is not ready yet" },
          { status: 409 },
        )
      }

      if (
        readiness.totalEligibleBlocks > 0 &&
        readiness.voices[voiceId].audioBlockIds.length ===
          readiness.totalEligibleBlocks
      ) {
        return HttpServerResponse.jsonUnsafe({
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

      return HttpServerResponse.jsonUnsafe(result)
    }),
  ),

  HttpRouter.route(
    "POST",
    "/api/tts/unload",
    Effect.gen(function* () {
      yield* requireAuth
      const config = yield* AppConfig
      const isProduction =
        config.environment === "prod" || config.environment === "production"

      if (config.ttsBackend !== "local" || isProduction) {
        return HttpServerResponse.jsonUnsafe(
          { error: "TTS unload is only available in local development" },
          { status: 404 },
        )
      }

      const ttsService = yield* TtsService
      const results: Record<string, boolean> = {}
      for (const engine of ["qwen3", "kokoro"] as const) {
        const result = yield* ttsService.unloadWorker(engine).pipe(Effect.result)
        results[engine] = result._tag === "Success"
      }

      return HttpServerResponse.jsonUnsafe({ unloaded: results })
    }),
  ),
])
