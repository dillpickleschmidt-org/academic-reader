// Shared type definitions

export type BackendType = 'local' | 'runpod' | 'datalab';
export type OutputFormat = 'html' | 'markdown' | 'json';
export type JobStatus = 'pending' | 'processing' | 'html_ready' | 'completed' | 'failed';

export interface ConversionInput {
  fileId: string;
  fileUrl?: string;          // For Runpod/local (S3 URL)
  fileData?: ArrayBuffer;    // For Datalab (direct upload)
  filename?: string;         // For Datalab (original filename)
  outputFormat: OutputFormat;
  useLlm: boolean;
  forceOcr: boolean;
  pageRange?: string;
}

export interface ConversionProgress {
  stage: string;
  current: number;
  total: number;
  elapsed?: number;
}

export interface ConversionResult {
  content: string;
  metadata: Record<string, unknown>;
}

export interface ConversionJob {
  jobId: string;
  status: JobStatus;
  result?: ConversionResult;
  htmlContent?: string;
  error?: string;
  progress?: ConversionProgress;
}

export interface UploadResult {
  fileId: string;
  filename: string;
  size: number;
}

export interface PresignedUrlResult {
  uploadUrl: string;
  fileId: string;
  expiresAt: string;
}

// Environment bindings
export interface Env {
  // Backend selection
  CONVERSION_BACKEND: BackendType;

  // Local backend
  LOCAL_WORKER_URL?: string;

  // Runpod backend
  RUNPOD_ENDPOINT_ID?: string;
  RUNPOD_API_KEY?: string;

  // Datalab backend
  DATALAB_API_KEY?: string;

  // Webhook
  WEBHOOK_SECRET?: string;
  WEBHOOK_BASE_URL?: string;

  // S3-compatible storage (for Runpod mode)
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_BUCKET?: string;
  S3_PUBLIC_URL?: string;

  // KV for job state (Cloudflare Workers only)
  JOBS_KV?: KVNamespace;

  // CORS
  CORS_ORIGINS?: string;
}
