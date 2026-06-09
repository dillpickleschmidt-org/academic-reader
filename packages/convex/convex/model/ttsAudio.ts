/**
 * TTS audio cache model - stores synthesized audio metadata for reuse.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import ttsManifest from "../../../api-client/src/tts-manifest.json"
import type { TtsChunkPreparation, WordTimestamp } from "../validators"
import { requireAuth } from "./auth"
import { requireApiToConvexServiceSecret } from "./serverAuth"

const VOICE_IDS = ttsManifest.voices.map((voice) => voice.id)

interface AudioRecord {
  storagePath: string
  durationMs: number
  sampleRate: number
  wordTimestamps: WordTimestamp[]
  text: string
}

interface CreateAudioInput {
  documentId: Id<"documents">
  blockId: string
  voiceId: string
  storagePath: string
  durationMs: number
  sampleRate: number
  wordTimestamps: WordTimestamp[]
}

type ChunkPreparationInput = TtsChunkPreparation

interface ServerGenerationState {
  document: {
    documentId: string
    userId: string
  }
  ttsReady: boolean
  missingChunks: Array<{
    blockId: string
    ttsText: string
    order: number
  }>
}

export async function getBlockAudio(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  blockId: string,
  voiceId: string,
): Promise<AudioRecord | null> {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const record = await ctx.db
    .query("ttsAudio")
    .withIndex("by_document_block_voice", (q) =>
      q
        .eq("documentId", documentId)
        .eq("blockId", blockId)
        .eq("voiceId", voiceId),
    )
    .first()

  if (!record) return null

  const chunk = await ctx.db
    .query("chunks")
    .withIndex("by_document_block", (q) =>
      q.eq("documentId", documentId).eq("blockId", blockId),
    )
    .first()

  if (!chunk?.ttsText) return null

  return {
    storagePath: record.storagePath,
    durationMs: record.durationMs,
    sampleRate: record.sampleRate,
    wordTimestamps: record.wordTimestamps,
    text: chunk.ttsText,
  }
}

export async function setChunkPreparation(
  ctx: MutationCtx,
  documentId: Id<"documents">,
  chunks: ChunkPreparationInput[],
  apiToConvexServiceSecret: string,
) {
  requireApiToConvexServiceSecret(apiToConvexServiceSecret)

  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")

  const byBlockId = new Map<string, ChunkPreparationInput>()
  for (const chunk of chunks) {
    if (byBlockId.has(chunk.blockId)) {
      throw new Error(`Duplicate TTS preparation for block: ${chunk.blockId}`)
    }
    if (chunk.includeTts && !chunk.ttsText?.trim()) {
      throw new Error(`TTS text required for block: ${chunk.blockId}`)
    }
    byBlockId.set(chunk.blockId, chunk)
  }

  const chunksToPatch = (
    await Promise.all(
      [...byBlockId.values()].map(async (chunk) => {
        const existing = await ctx.db
          .query("chunks")
          .withIndex("by_document_block", (q) =>
            q.eq("documentId", documentId).eq("blockId", chunk.blockId),
          )
          .first()
        return existing ? { chunk, existing } : null
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  await Promise.all(
    chunksToPatch.map(({ chunk, existing }) =>
      ctx.db.patch(existing._id, {
        includeTts: chunk.includeTts,
        ttsText: chunk.includeTts ? chunk.ttsText : null,
      }),
    ),
  )

  return { updated: chunksToPatch.length }
}

export async function createAudioForServer(
  ctx: MutationCtx,
  input: CreateAudioInput & { apiToConvexServiceSecret: string },
): Promise<Id<"ttsAudio">> {
  requireApiToConvexServiceSecret(input.apiToConvexServiceSecret)

  const doc = await ctx.db.get(input.documentId)
  if (!doc) throw new Error("Document not found")

  return upsertAudio(ctx, input)
}

export async function getGenerationState(
  ctx: QueryCtx,
  documentId: Id<"documents">,
  voiceId: string,
  apiToConvexServiceSecret: string,
): Promise<ServerGenerationState> {
  requireApiToConvexServiceSecret(apiToConvexServiceSecret)

  const doc = await ctx.db.get(documentId)
  if (!doc) throw new Error("Document not found")
  if (!VOICE_IDS.includes(voiceId)) {
    throw new Error(`Unknown voice: ${voiceId}`)
  }

  const { hasUndecidedTts, eligibleChunks } = await getTtsEligibility(
    ctx,
    documentId,
  )
  const records = await ctx.db
    .query("ttsAudio")
    .withIndex("by_document_block_voice", (q) => q.eq("documentId", documentId))
    .filter((q) => q.eq(q.field("voiceId"), voiceId))
    .collect()

  const existing = new Set(records.map((record) => record.blockId))
  return {
    document: {
      documentId,
      userId: doc.userId,
    },
    ttsReady: !hasUndecidedTts,
    missingChunks: eligibleChunks
      .filter((chunk) => !existing.has(chunk.blockId))
      .map((chunk) => ({
        blockId: chunk.blockId,
        ttsText: chunk.ttsText,
        order: chunk.order,
      })),
  }
}

export async function getDocumentAudioReadiness(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const user = await requireAuth(ctx)
  const doc = await ctx.db.get(documentId)

  if (!doc) throw new Error("Document not found")
  if (doc.userId !== user._id) throw new Error("Unauthorized")

  const { hasUndecidedTts, eligibleBlockIds } = await getTtsEligibility(
    ctx,
    documentId,
  )

  const records = await ctx.db
    .query("ttsAudio")
    .withIndex("by_document_block_voice", (q) => q.eq("documentId", documentId))
    .collect()

  const eligibleSet = new Set(eligibleBlockIds)
  const voices = Object.fromEntries(
    VOICE_IDS.map((voiceId) => [
      voiceId,
      {
        audioBlockIds: [] as string[],
        latestAudioCreatedAt: null as number | null,
      },
    ]),
  )

  for (const record of records) {
    if (!eligibleSet.has(record.blockId)) continue
    const voice = voices[record.voiceId]
    voice.audioBlockIds.push(record.blockId)
    voice.latestAudioCreatedAt =
      voice.latestAudioCreatedAt === null
        ? record._creationTime
        : Math.max(voice.latestAudioCreatedAt, record._creationTime)
  }

  return {
    documentCreatedAt: doc._creationTime,
    ttsReady: !hasUndecidedTts,
    eligibleBlockIds,
    totalEligibleBlocks: eligibleBlockIds.length,
    voices,
  }
}

async function getTtsEligibility(
  ctx: QueryCtx,
  documentId: Id<"documents">,
) {
  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .collect()

  const sortedChunks = chunks.sort((a, b) => a.order - b.order)
  const hasUndecidedTts = sortedChunks.some(
    (chunk) => chunk.includeTts === null,
  )
  const eligibleChunks = sortedChunks.filter(hasTtsText)
  const eligibleBlockIds = eligibleChunks.map((chunk) => chunk.blockId)

  return { hasUndecidedTts, eligibleBlockIds, eligibleChunks }
}

function hasTtsText(
  chunk: Doc<"chunks">,
): chunk is Doc<"chunks"> & { includeTts: true; ttsText: string } {
  return (
    chunk.includeTts === true &&
    chunk.ttsText !== null &&
    chunk.ttsText.trim() !== ""
  )
}

async function upsertAudio(
  ctx: MutationCtx,
  input: CreateAudioInput,
): Promise<Id<"ttsAudio">> {
  if (!VOICE_IDS.includes(input.voiceId)) {
    throw new Error(`Unknown voice: ${input.voiceId}`)
  }

  const chunk = await ctx.db
    .query("chunks")
    .withIndex("by_document_block", (q) =>
      q.eq("documentId", input.documentId).eq("blockId", input.blockId),
    )
    .first()

  if (!chunk) throw new Error("Chunk not found for document")

  const existing = await ctx.db
    .query("ttsAudio")
    .withIndex("by_document_block_voice", (q) =>
      q
        .eq("documentId", input.documentId)
        .eq("blockId", input.blockId)
        .eq("voiceId", input.voiceId),
    )
    .first()

  if (existing) {
    await ctx.db.delete(existing._id)
  }

  return ctx.db.insert("ttsAudio", {
    documentId: input.documentId,
    blockId: input.blockId,
    voiceId: input.voiceId,
    storagePath: input.storagePath,
    durationMs: input.durationMs,
    sampleRate: input.sampleRate,
    wordTimestamps: input.wordTimestamps,
  })
}
