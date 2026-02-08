import { Schema } from "effect"
import { ConversionResult } from "./document"
import { ProcessingMode, JobStatus } from "./common"

export const ConversionProgress = Schema.Struct({
  stage: Schema.String,
  current: Schema.Number,
  total: Schema.Number,
})
export type ConversionProgress = typeof ConversionProgress.Type

export const ConversionInput = Schema.Struct({
  fileId: Schema.String,
  fileUrl: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  processingMode: ProcessingMode,
  useLlm: Schema.Boolean,
  pageRange: Schema.String,
  documentPath: Schema.optional(Schema.String),
})
export type ConversionInput = typeof ConversionInput.Type

export const ConversionJob = Schema.Struct({
  jobId: Schema.String,
  status: JobStatus,
  result: Schema.optional(ConversionResult),
  htmlContent: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  progress: Schema.optional(ConversionProgress),
  s3Result: Schema.optional(Schema.Boolean),
})
export type ConversionJob = typeof ConversionJob.Type
