import { Schema } from "effect"
import { ProcessingMode } from "./common"

export const UploadResponse = Schema.Struct({
  file_id: Schema.String,
  filename: Schema.String,
  size: Schema.Number,
  content_type: Schema.String,
  page_count: Schema.optional(Schema.Number),
})
export type UploadResponse = typeof UploadResponse.Type

export const ConversionOptions = Schema.Struct({
  processingMode: ProcessingMode,
  useLlm: Schema.Boolean,
  forceOcr: Schema.Boolean,
  pageRange: Schema.String,
  audioVoiceId: Schema.String,
})
export type ConversionOptions = typeof ConversionOptions.Type

export const PresignedUrlResult = Schema.Struct({
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
})
export type PresignedUrlResult = typeof PresignedUrlResult.Type
