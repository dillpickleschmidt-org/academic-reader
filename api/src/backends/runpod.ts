import type { ConversionBackend } from './interface';
import type { ConversionInput, ConversionJob, JobStatus } from '../types';

interface RunpodConfig {
  endpointId: string;
  apiKey: string;
  webhookUrl?: string;
}

/**
 * Runpod backend - self-hosted serverless GPU on Runpod.
 */
export class RunpodBackend implements ConversionBackend {
  readonly name = 'runpod';
  private config: RunpodConfig;
  private baseUrl: string;

  constructor(config: RunpodConfig) {
    this.config = config;
    this.baseUrl = `https://api.runpod.ai/v2/${config.endpointId}`;
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const inputPayload: Record<string, unknown> = {
      file_url: input.fileUrl,
      output_format: input.outputFormat,
      use_llm: input.useLlm,
      force_ocr: input.forceOcr,
      page_range: input.pageRange,
    };

    // Pass progress webhook URL to worker
    if (this.config.webhookUrl) {
      inputPayload.progress_webhook_url = this.config.webhookUrl.replace('/webhooks/runpod', '/webhooks/progress');
    }

    const body: Record<string, unknown> = { input: inputPayload };

    if (this.config.webhookUrl) {
      body.webhook = this.config.webhookUrl;
    }

    const response = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Runpod submission failed: ${error}`);
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get job status: ${jobId}`);
    }

    const data = (await response.json()) as {
      id: string;
      status: string;
      output?: { content: string; metadata: Record<string, unknown> };
      error?: string;
    };

    return {
      jobId: data.id,
      status: this.mapStatus(data.status),
      result: data.output,
      error: data.error,
    };
  }

  private mapStatus(runpodStatus: string): JobStatus {
    switch (runpodStatus) {
      case 'IN_QUEUE':
        return 'pending';
      case 'IN_PROGRESS':
        return 'processing';
      case 'COMPLETED':
        return 'completed';
      case 'FAILED':
        return 'failed';
      default:
        return 'pending';
    }
  }

  supportsStreaming(): boolean {
    return false;
  }

  async handleWebhook(request: Request): Promise<ConversionJob> {
    const data = (await request.json()) as {
      id: string;
      status: string;
      output?: { content: string; metadata: Record<string, unknown> };
      error?: string;
    };

    return {
      jobId: data.id,
      status: this.mapStatus(data.status),
      result: data.output,
      error: data.error,
    };
  }
}

/**
 * Create Runpod backend from environment.
 */
export function createRunpodBackend(env: {
  RUNPOD_ENDPOINT_ID?: string;
  RUNPOD_API_KEY?: string;
  WEBHOOK_BASE_URL?: string;
}): RunpodBackend {
  if (!env.RUNPOD_ENDPOINT_ID || !env.RUNPOD_API_KEY) {
    throw new Error('Runpod backend requires RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY');
  }

  return new RunpodBackend({
    endpointId: env.RUNPOD_ENDPOINT_ID,
    apiKey: env.RUNPOD_API_KEY,
    webhookUrl: env.WEBHOOK_BASE_URL ? `${env.WEBHOOK_BASE_URL}/webhooks/runpod` : undefined,
  });
}
