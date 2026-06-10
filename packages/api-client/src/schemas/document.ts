import { Schema } from "effect"
import { ProcessingMode } from "./common"

export const CreateDocumentRequest = Schema.Struct({
  fileId: Schema.NonEmptyString,
  filename: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  sizeBytes: Schema.Number,
  pageCount: Schema.NullOr(Schema.Number),
  processingMode: ProcessingMode,
  useLlm: Schema.Boolean,
  forceOcr: Schema.Boolean,
  pageRange: Schema.String,
  audioVoiceId: Schema.String,
})
export type CreateDocumentRequest = typeof CreateDocumentRequest.Type

export const ChunkBlock = Schema.Struct({
  id: Schema.String,
  block_type: Schema.String,
  html: Schema.String,
  polygon: Schema.Array(Schema.Array(Schema.Number)),
  bbox: Schema.Array(Schema.Number),
  order: Schema.Number,
  includeTts: Schema.NullOr(Schema.Boolean),
  ttsText: Schema.NullOr(Schema.String),
})
export type ChunkBlock = typeof ChunkBlock.Type

export interface TocSection {
  readonly id: string
  readonly title: string
  readonly page: number
  readonly children?: ReadonlyArray<TocSection> | undefined
}

export const TocSection: Schema.Schema<TocSection> = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  page: Schema.Number,
  children: Schema.optional(Schema.Array(Schema.suspend(() => TocSection))),
})

export const TocResult = Schema.Struct({
  sections: Schema.Array(TocSection),
  offset: Schema.Number,
  hasRomanNumerals: Schema.optional(Schema.Boolean),
})
export type TocResult = typeof TocResult.Type

export const LoadedDocument = Schema.Struct({
  html: Schema.String,
  markdown: Schema.String,
  chunks: Schema.Array(ChunkBlock),
  toc: Schema.NullOr(TocResult),
})
export type LoadedDocument = typeof LoadedDocument.Type

export const CreateDocumentResponse = Schema.Struct({
  documentId: Schema.String,
})
export type CreateDocumentResponse = typeof CreateDocumentResponse.Type
