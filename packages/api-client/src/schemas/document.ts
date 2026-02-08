import { Schema } from "effect"

export const ChunkBlock = Schema.Struct({
  id: Schema.String,
  block_type: Schema.String,
  html: Schema.String,
  polygon: Schema.Array(Schema.Array(Schema.Number)),
  bbox: Schema.Array(Schema.Number),
  includeTts: Schema.optional(Schema.Boolean),
  ttsText: Schema.optional(Schema.String),
  section_hierarchy: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  images: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export type ChunkBlock = typeof ChunkBlock.Type

export const ChunkOutput = Schema.Struct({
  blocks: Schema.Array(ChunkBlock),
  page_info: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      bbox: Schema.Array(Schema.Number),
      polygon: Schema.Array(Schema.Array(Schema.Number)),
    }),
  }),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type ChunkOutput = typeof ChunkOutput.Type

export const AllFormats = Schema.Struct({
  html: Schema.String,
  markdown: Schema.String,
  chunks: Schema.optional(ChunkOutput),
})
export type AllFormats = typeof AllFormats.Type

export const ConversionResult = Schema.Struct({
  content: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  formats: Schema.optional(AllFormats),
  images: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export type ConversionResult = typeof ConversionResult.Type

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
  toc: TocResult,
  documentId: Schema.String,
  storageId: Schema.String,
})
export type LoadedDocument = typeof LoadedDocument.Type
