import { Context, Effect, Layer } from "effect"
import { HttpServerRequest } from "@effect/platform"
import { ConvexHttpClient } from "convex/browser"
import { getToken } from "@convex-dev/better-auth/utils"
import { api } from "@academic-reader/convex/convex/_generated/api"
import type {
  Doc,
  Id,
} from "@academic-reader/convex/convex/_generated/dataModel"
import type { WordTimestamp } from "@academic-reader/api-client/schemas/tts"
import { AuthError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"

interface ConvexConnectionConfig {
  httpUrl: string
  siteUrl: string
  serverSecret: string
}

export interface DocumentChunkInput {
  blockId: string
  blockType: string
  html: string
  section: string | null
  bbox: number[]
  order: number
  includeTts: boolean | null
}

export interface TtsChunkPreparation {
  blockId: string
  includeTts: boolean
  ttsText: string | null
}

export interface BlockAudioRecord {
  storagePath: string
  durationMs: number
  sampleRate: number
  text: string
  wordTimestamps: WordTimestamp[]
}

export interface DocumentAudioReadiness {
  ttsReady: boolean
  totalEligibleBlocks: number
  voices: Record<string, { audioBlockIds: string[] }>
}

export interface TtsGenerationState {
  document: {
    storageId: string
    userId: string
  }
  ttsReady: boolean
  missingChunks: Array<{
    blockId: string
    ttsText: string
    order: number
  }>
}

export interface CreateTtsAudioInput {
  documentId: string
  blockId: string
  voiceId: string
  storagePath: string
  durationMs: number
  sampleRate: number
  wordTimestamps: WordTimestamp[]
}

export interface RemoveDocumentResult {
  deleted: boolean
  chunkCount: number
  audioCount: number
  threadCount: number
  messageCount: number
  threadAction: "keep" | "delete"
}

export type ChatMessageParts = Doc<"chatMessages">["parts"]

export interface DocumentTocChild {
  id: string
  title: string
  page: number
}

export interface DocumentTocSection extends DocumentTocChild {
  children?: DocumentTocChild[]
}

export interface DocumentToc {
  sections: DocumentTocSection[]
  offset: number
  hasRomanNumerals?: boolean
}

export interface ConvexSession {
  getDocument(documentId: string): Promise<Doc<"documents">>
  getDocumentChunks(documentId: string): Promise<Doc<"chunks">[]>
  createDocument(input: {
    filename: string
    storageId: string
    pageCount: number | null
    toc: DocumentToc | null
  }): Promise<{ documentId: Id<"documents">; storageId: string }>
  addDocumentChunks(
    documentId: string,
    chunks: DocumentChunkInput[],
  ): Promise<{ added: number }>
  updateDocumentToc(
    documentId: string,
    toc: DocumentToc,
  ): Promise<{ updated: boolean }>
  updateDocumentSummary(
    documentId: string,
    summary: string,
  ): Promise<{ updated: boolean }>
  removeDocument(
    documentId: string,
    threadAction: "keep" | "delete",
  ): Promise<RemoveDocumentResult>
  hasDocumentEmbeddings(documentId: string): Promise<boolean>
  addDocumentEmbeddings(
    documentId: string,
    embeddings: number[][],
  ): Promise<{ updated: number }>
  getBlockAudio(
    documentId: string,
    blockId: string,
    voiceId: string,
  ): Promise<BlockAudioRecord | null>
  getDocumentAudioReadiness(
    documentId: string,
  ): Promise<DocumentAudioReadiness>
  addMessageAndStartStreaming(
    threadId: string,
    parts: ChatMessageParts,
  ): Promise<null>
  setChatStreaming(threadId: string, isStreaming: boolean): Promise<null>
  finishChatStreaming(
    threadId: string,
    parts: ChatMessageParts,
    title?: string,
  ): Promise<null>
  updateChatThreadTitle(threadId: string, title: string): Promise<null>
  searchDocument(
    documentId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<Array<{ html: string; page: number; section: string | null }>>
}

export interface ConvexServerSession {
  setTtsChunkPreparation(
    documentId: string,
    chunks: TtsChunkPreparation[],
  ): Promise<{ updated: number }>
  getTtsGenerationState(
    documentId: string,
    voiceId: string,
  ): Promise<TtsGenerationState>
  createTtsAudio(input: CreateTtsAudioInput): Promise<Id<"ttsAudio">>
}

export interface ConvexClientService {
  fromRequest(): Effect.Effect<
    ConvexSession,
    AuthError,
    HttpServerRequest.HttpServerRequest
  >
  server(): ConvexServerSession
}

export class ConvexClient extends Context.Tag("ConvexClient")<
  ConvexClient,
  ConvexClientService
>() {
  static Live = Layer.effect(
    ConvexClient,
    Effect.gen(function* () {
      const config = yield* AppConfig

      return {
        fromRequest: () =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const session = yield* connectConvexSessionFromCookies(
              config.convex,
              request.cookies,
            )

            if (!session) {
              return yield* new AuthError({
                message: "No valid session token",
                code: "NO_SESSION",
              })
            }

            return session
          }),
        server: () => createConvexServerSession(config.convex),
      }
    }),
  )
}

export function createConvexSessionFromCookies(
  config: ConvexConnectionConfig,
  cookies: Record<string, string>,
): Effect.Effect<ConvexSession | null> {
  return connectConvexSessionFromCookies(config, cookies).pipe(
    Effect.catchAll(() => Effect.succeed(null)),
  )
}

function connectConvexSessionFromCookies(
  config: ConvexConnectionConfig,
  cookies: Record<string, string>,
): Effect.Effect<ConvexSession | null, AuthError> {
  return Effect.tryPromise({
    try: async () => {
      const headers = new Headers()
      const cookieStr = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
      if (cookieStr) headers.set("Cookie", cookieStr)

      const { token } = await getToken(config.httpUrl, headers)
      if (!token) return null

      const client = new ConvexHttpClient(config.siteUrl)
      client.setAuth(token)
      return makeConvexSession(client)
    },
    catch: (e) =>
      new AuthError({
        message: `Convex auth failed: ${e instanceof Error ? e.message : String(e)}`,
        code: "CONVEX_AUTH_ERROR",
      }),
  })
}

export function createConvexServerSession(
  config: Pick<ConvexConnectionConfig, "siteUrl" | "serverSecret">,
): ConvexServerSession {
  const client = new ConvexHttpClient(config.siteUrl)

  return {
    setTtsChunkPreparation: (documentId, chunks) =>
      client.mutation(api.api.ttsAudio.setChunkPreparation, {
        documentId: documentId as Id<"documents">,
        chunks,
        serverSecret: config.serverSecret,
      }),
    getTtsGenerationState: (documentId, voiceId) =>
      client.query(api.api.ttsAudio.getGenerationState, {
        documentId: documentId as Id<"documents">,
        voiceId,
        serverSecret: config.serverSecret,
      }),
    createTtsAudio: (input) =>
      client.mutation(api.api.ttsAudio.createAudioForServer, {
        documentId: input.documentId as Id<"documents">,
        blockId: input.blockId,
        voiceId: input.voiceId,
        storagePath: input.storagePath,
        durationMs: input.durationMs,
        sampleRate: input.sampleRate,
        wordTimestamps: input.wordTimestamps,
        serverSecret: config.serverSecret,
      }),
  }
}

function makeConvexSession(client: ConvexHttpClient): ConvexSession {
  return {
    getDocument: (documentId) =>
      client.query(api.api.documents.get, {
        documentId: documentId as Id<"documents">,
      }),
    getDocumentChunks: (documentId) =>
      client.query(api.api.documents.getChunks, {
        documentId: documentId as Id<"documents">,
      }),
    createDocument: (input) =>
      client.mutation(api.api.documents.create, {
        filename: input.filename,
        storageId: input.storageId,
        pageCount: input.pageCount,
        toc: input.toc === null ? null : normalizeDocumentToc(input.toc),
      }),
    addDocumentChunks: (documentId, chunks) =>
      client.mutation(api.api.documents.addChunks, {
        documentId: documentId as Id<"documents">,
        chunks,
      }),
    updateDocumentToc: (documentId, toc) =>
      client.mutation(api.api.documents.updateToc, {
        documentId: documentId as Id<"documents">,
        toc: normalizeDocumentToc(toc),
      }),
    updateDocumentSummary: (documentId, summary) =>
      client.mutation(api.api.documents.updateSummary, {
        documentId: documentId as Id<"documents">,
        summary,
      }),
    removeDocument: (documentId, threadAction) =>
      client.mutation(api.api.documents.remove, {
        documentId: documentId as Id<"documents">,
        threadAction,
      }),
    hasDocumentEmbeddings: (documentId) =>
      client.query(api.api.documents.hasEmbeddings, {
        documentId: documentId as Id<"documents">,
      }),
    addDocumentEmbeddings: (documentId, embeddings) =>
      client.mutation(api.api.documents.addEmbeddings, {
        documentId: documentId as Id<"documents">,
        embeddings,
      }),
    getBlockAudio: (documentId, blockId, voiceId) =>
      client.query(api.api.ttsAudio.getBlockAudio, {
        documentId: documentId as Id<"documents">,
        blockId,
        voiceId,
      }),
    getDocumentAudioReadiness: (documentId) =>
      client.query(api.api.ttsAudio.getDocumentAudioReadiness, {
        documentId: documentId as Id<"documents">,
      }),
    addMessageAndStartStreaming: (threadId, parts) =>
      client.mutation(api.api.chat.addMessageAndStartStreaming, {
        threadId: threadId as Id<"chatThreads">,
        parts,
      }),
    setChatStreaming: (threadId, isStreaming) =>
      client.mutation(api.api.chat.setStreaming, {
        threadId: threadId as Id<"chatThreads">,
        isStreaming,
      }),
    finishChatStreaming: (threadId, parts, title) =>
      client.mutation(api.api.chat.finishStreaming, {
        threadId: threadId as Id<"chatThreads">,
        parts,
        title,
      }),
    updateChatThreadTitle: (threadId, title) =>
      client.mutation(api.api.chat.updateThreadTitle, {
        threadId: threadId as Id<"chatThreads">,
        title,
      }),
    searchDocument: (documentId, queryEmbedding, limit) =>
      client.action(api.api.documents.search, {
        documentId: documentId as Id<"documents">,
        queryEmbedding,
        limit,
      }),
  }
}

function normalizeDocumentToc(toc: DocumentToc): DocumentToc {
  return {
    sections: toc.sections.map((section) => ({
      id: section.id,
      title: section.title,
      page: section.page,
      children: section.children?.map((child) => ({
        id: child.id,
        title: child.title,
        page: child.page,
      })),
    })),
    offset: toc.offset,
    hasRomanNumerals: toc.hasRomanNumerals,
  }
}
