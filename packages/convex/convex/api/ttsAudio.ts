/**
 * TTS API - thin layer for narration preparation and audio caching.
 */

import { v } from "convex/values"
import { mutation, query } from "../_generated/server"
import * as TtsAudio from "../model/ttsAudio"

const wordTimestampValidator = v.object({
  word: v.string(),
  startMs: v.number(),
  endMs: v.number(),
})

const chunkPreparationValidator = v.object({
  blockId: v.string(),
  includeTts: v.boolean(),
  ttsText: v.union(v.string(), v.null()),
})

export const getBlockAudio = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
  },
  handler: (ctx, { documentId, blockId, voiceId }) =>
    TtsAudio.getBlockAudio(ctx, documentId, blockId, voiceId),
})

export const getDocumentAudioReadiness = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: (ctx, { documentId }) =>
    TtsAudio.getDocumentAudioReadiness(ctx, documentId),
})

export const setChunkPreparation = mutation({
  args: {
    documentId: v.id("documents"),
    chunks: v.array(chunkPreparationValidator),
    serverSecret: v.string(),
  },
  handler: (ctx, { documentId, chunks, serverSecret }) =>
    TtsAudio.setChunkPreparation(ctx, documentId, chunks, serverSecret),
})

export const getGenerationState = query({
  args: {
    documentId: v.id("documents"),
    voiceId: v.string(),
    serverSecret: v.string(),
  },
  handler: (ctx, { documentId, voiceId, serverSecret }) =>
    TtsAudio.getGenerationState(ctx, documentId, voiceId, serverSecret),
})

export const createAudioForServer = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
    voiceId: v.string(),
    storagePath: v.string(),
    durationMs: v.number(),
    sampleRate: v.number(),
    wordTimestamps: v.array(wordTimestampValidator),
    serverSecret: v.string(),
  },
  handler: (ctx, args) => TtsAudio.createAudioForServer(ctx, args),
})
