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
import type { ProcessingMode } from "@academic-reader/api-client/schemas/common"
import { AuthError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"

interface ConvexConnectionConfig {
  apiUrl: string
  httpActionsUrl: string
  apiToConvexServiceSecret: string
}

interface DocumentChunkInput {
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

interface BlockAudioRecord {
  storagePath: string
  durationMs: number
  sampleRate: number
  text: string
  wordTimestamps: WordTimestamp[]
}

interface DocumentAudioReadiness {
  ttsReady: boolean
  totalEligibleBlocks: number
  voices: Record<string, { audioBlockIds: string[] }>
}

interface TtsGenerationState {
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

interface CreateTtsAudioInput {
  documentId: string
  blockId: string
  voiceId: string
  storagePath: string
  durationMs: number
  sampleRate: number
  wordTimestamps: WordTimestamp[]
}

interface RemoveDocumentResult {
  deleted: boolean
  chunkCount: number
  audioCount: number
  taskCount: number
  threadCount: number
  messageCount: number
  threadAction: "keep" | "delete"
}

interface CreateDocumentInput {
  filename: string
  mimeType: string
  sizeBytes: number
  pageCount: number | null
  conversion: {
    processingMode: ProcessingMode
    useLlm: boolean
    forceOcr: boolean
    pageRange: string
    audioVoiceId: string | null
  }
}

interface CreateDocumentTaskInput {
  documentId: string
  kind: Doc<"documentTasks">["kind"]
  status: Doc<"documentTasks">["status"]
  progress: Doc<"documentTasks">["progress"]
  error: string | null
  conversion: Doc<"documentTasks">["conversion"]
}

interface UpdateDocumentTaskInput {
  status?: Doc<"documentTasks">["status"]
  progress?: Doc<"documentTasks">["progress"]
  error?: string | null
  conversion?: Doc<"documentTasks">["conversion"]
}

interface DocumentTocChild {
  id: string
  title: string
  page: number
}

interface DocumentTocSection extends DocumentTocChild {
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
  createDocument(input: CreateDocumentInput): Promise<{
    documentId: Id<"documents">
    conversionTaskId: Id<"documentTasks">
  }>
  listDocumentTasks(documentId: string): Promise<Doc<"documentTasks">[]>
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
  addUserMessage(
    threadId: string,
    parts: Doc<"chatMessages">["parts"],
  ): Promise<null>
  addAssistantMessage(
    threadId: string,
    parts: Doc<"chatMessages">["parts"],
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
  createDocumentTask(input: CreateDocumentTaskInput): Promise<Id<"documentTasks">>
  updateDocumentTask(
    taskId: string,
    patch: UpdateDocumentTaskInput,
  ): Promise<{ updated: boolean }>
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

interface ConvexClientService {
  userSession(): Effect.Effect<
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
        userSession: () =>
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

      const { token } = await getToken(config.httpActionsUrl, headers)
      if (!token) return null

      const client = new ConvexHttpClient(config.apiUrl)
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

function createConvexServerSession(
  config: Pick<
    ConvexConnectionConfig,
    "apiUrl" | "apiToConvexServiceSecret"
  >,
): ConvexServerSession {
  const client = new ConvexHttpClient(config.apiUrl)

  return {
    createDocumentTask: (input) =>
      client.mutation(api.api.documentTasks.createForServer, {
        documentId: input.documentId as Id<"documents">,
        kind: input.kind,
        status: input.status,
        progress: input.progress,
        error: input.error,
        conversion: input.conversion,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    updateDocumentTask: (taskId, patch) =>
      client.mutation(api.api.documentTasks.updateForServer, {
        taskId: taskId as Id<"documentTasks">,
        ...patch,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    addDocumentChunks: (documentId, chunks) =>
      client.mutation(api.api.documents.addChunksForServer, {
        documentId: documentId as Id<"documents">,
        chunks,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    updateDocumentToc: (documentId, toc) =>
      client.mutation(api.api.documents.updateTocForServer, {
        documentId: documentId as Id<"documents">,
        toc: normalizeDocumentToc(toc),
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    updateDocumentSummary: (documentId, summary) =>
      client.mutation(api.api.documents.updateSummaryForServer, {
        documentId: documentId as Id<"documents">,
        summary,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    setTtsChunkPreparation: (documentId, chunks) =>
      client.mutation(api.api.ttsAudio.setChunkPreparation, {
        documentId: documentId as Id<"documents">,
        chunks,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
      }),
    getTtsGenerationState: (documentId, voiceId) =>
      client.query(api.api.ttsAudio.getGenerationState, {
        documentId: documentId as Id<"documents">,
        voiceId,
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
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
        apiToConvexServiceSecret: config.apiToConvexServiceSecret,
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
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        pageCount: input.pageCount,
        conversion: input.conversion,
      }),
    listDocumentTasks: (documentId) =>
      client.query(api.api.documentTasks.listForDocument, {
        documentId: documentId as Id<"documents">,
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
    addUserMessage: (threadId, parts) =>
      client.mutation(api.api.chat.addUserMessage, {
        threadId: threadId as Id<"chatThreads">,
        parts,
      }),
    addAssistantMessage: (threadId, parts, title) =>
      client.mutation(api.api.chat.addAssistantMessage, {
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
