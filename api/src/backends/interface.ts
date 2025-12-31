import type { ConversionInput, ConversionJob } from '../types';

/**
 * Interface for conversion backends.
 * Each backend (local, runpod, datalab) implements this interface.
 */
export interface ConversionBackend {
  /**
   * Backend identifier for logging/debugging
   */
  readonly name: string;

  /**
   * Submit a conversion job
   * @returns The job ID for tracking
   */
  submitJob(input: ConversionInput): Promise<string>;

  /**
   * Get current job status
   * Used for polling-based status checks
   */
  getJobStatus(jobId: string): Promise<ConversionJob>;

  /**
   * Check if backend supports SSE streaming
   * Local backend does, cloud backends typically don't
   */
  supportsStreaming(): boolean;

  /**
   * Get SSE stream URL if backend supports streaming
   * @returns Stream URL or null if not supported
   */
  getStreamUrl?(jobId: string): string | null;

  /**
   * Handle webhook callback from backend
   * Used by Runpod and Datalab for async completion
   */
  handleWebhook?(request: Request): Promise<ConversionJob>;
}
