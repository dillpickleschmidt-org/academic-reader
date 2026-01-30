// Shared type definitions between frontend and API

export type BackendType = "local" | "datalab" | "modal"
export type ProcessingMode = "fast" | "balanced" | "aggressive"
export type JobStatus =
  | "pending"
  | "processing"
  | "html_ready"
  | "completed"
  | "failed"

export interface ConversionInput {
  fileId: string
  fileUrl?: string // For Modal/local (S3 URL)
  fileData?: ArrayBuffer | Buffer // For Datalab (direct upload)
  filename?: string // For Datalab (original filename)
  mimeType?: string // For determining file type
  processingMode: ProcessingMode
  useLlm: boolean // fast mode only, non-datalab
  pageRange: string // empty string = all pages
  documentPath?: string // For Modal S3 result upload
}

export interface ConversionProgress {
  stage: string
  current: number
  total: number
}

// Chunk output from Marker's ChunkRenderer
export interface ChunkBlock {
  id: string
  block_type: string
  html: string
  page: number
  polygon: number[][]
  bbox: number[]
  section_hierarchy?: Record<string, string>
  images?: Record<string, string>
}

export interface ChunkOutput {
  blocks: ChunkBlock[]
  page_info: Record<string, { bbox: number[]; polygon: number[][] }>
  metadata: Record<string, unknown>
}

export interface AllFormats {
  html: string
  markdown: string
  chunks?: ChunkOutput
}

export interface ConversionResult {
  content: string
  metadata: Record<string, unknown>
  formats?: AllFormats
  images?: Record<string, string> // For progressive image loading
}

export interface TocSection {
  id: string
  title: string
  page: number
  children?: TocSection[]
}

export interface TocResult {
  sections: TocSection[]
  offset: number
  hasRomanNumerals?: boolean
}

export interface ConversionJob {
  jobId: string
  status: JobStatus
  result?: ConversionResult
  htmlContent?: string
  error?: string
  progress?: ConversionProgress
  s3Result?: boolean // When true, result was uploaded to S3 (Modal only)
}

export interface UploadResult {
  fileId: string
  filename: string
  size: number
}

export interface LoadedDocument {
  html: string
  markdown: string
  chunks: ChunkBlock[]
  toc: TocResult
  documentId: string
  storageId: string
}

export interface PresignedUrlResult {
  uploadUrl: string
  expiresAt: string
}
