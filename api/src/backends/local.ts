import type { ConversionBackend } from './interface';
import type { ConversionInput, ConversionJob, JobStatus } from '../types';

/**
 * Local backend - passes through to FastAPI worker running locally.
 * Used for development when running docker compose.
 */
export class LocalBackend implements ConversionBackend {
  readonly name = 'local';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const params = new URLSearchParams({
      output_format: input.outputFormat,
      use_llm: String(input.useLlm),
      force_ocr: String(input.forceOcr),
    });

    if (input.pageRange) {
      params.set('page_range', input.pageRange);
    }

    const response = await fetch(
      `${this.baseUrl}/convert/${input.fileId}?${params}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local backend error: ${error}`);
    }

    const data = (await response.json()) as { job_id: string };
    return data.job_id;
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`);

    if (!response.ok) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const data = (await response.json()) as {
      job_id: string;
      status: JobStatus;
      result?: { content: string; metadata: Record<string, unknown> };
      html_content?: string;
      error?: string;
      progress?: { stage: string; current: number; total: number };
    };

    return {
      jobId: data.job_id,
      status: data.status,
      result: data.result,
      htmlContent: data.html_content,
      error: data.error,
      progress: data.progress,
    };
  }

  supportsStreaming(): boolean {
    return true;
  }

  getStreamUrl(jobId: string): string {
    return `${this.baseUrl}/jobs/${jobId}/stream`;
  }
}
