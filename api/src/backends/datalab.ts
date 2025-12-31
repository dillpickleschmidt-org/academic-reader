import type { ConversionBackend } from './interface';
import type { ConversionInput, ConversionJob, JobStatus } from '../types';

interface DatalabConfig {
  apiKey: string;
  webhookUrl?: string;
}

interface DatalabResponse {
  request_id: string;
  status: string;
  success?: boolean;
  markdown?: string;
  html?: string;
  json?: string;
  error?: string;
  images?: Record<string, string>;
}

/**
 * Datalab backend - hosted Marker API from Datalab.
 * API docs: https://www.datalab.to/docs/marker
 */
export class DatalabBackend implements ConversionBackend {
  readonly name = 'datalab';
  private config: DatalabConfig;
  private readonly baseUrl = 'https://www.datalab.to/api/v1/marker';

  constructor(config: DatalabConfig) {
    this.config = config;
  }

  async submitJob(input: ConversionInput): Promise<string> {
    const formData = new FormData();

    // Direct file upload - Datalab accepts file as multipart form data
    if (!input.fileData) {
      throw new Error('Datalab backend requires fileData for direct upload');
    }

    const blob = new Blob([input.fileData], { type: 'application/pdf' });
    formData.append('file', blob, input.filename || 'document.pdf');

    // Output format
    formData.append('output_format', input.outputFormat);

    // Mode: balanced (default) or accurate (with LLM/Gemini 2.0 Flash)
    formData.append('mode', input.useLlm ? 'accurate' : 'balanced');

    if (input.forceOcr) {
      formData.append('force_ocr', 'true');
    }

    if (input.pageRange) {
      formData.append('page_range', input.pageRange);
    }

    if (this.config.webhookUrl) {
      formData.append('webhook_url', this.config.webhookUrl);
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': this.config.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Datalab submission failed: ${error}`);
    }

    const data = (await response.json()) as { request_id: string; status: string };
    return data.request_id;
  }

  async getJobStatus(jobId: string): Promise<ConversionJob> {
    const response = await fetch(`${this.baseUrl}/${jobId}`, {
      headers: {
        'X-API-Key': this.config.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get job status: ${jobId}`);
    }

    const data = (await response.json()) as DatalabResponse;
    return this.parseResponse(data);
  }

  private mapStatus(datalabStatus: string, success?: boolean): JobStatus {
    switch (datalabStatus) {
      case 'pending':
        return 'pending';
      case 'processing':
        return 'processing';
      case 'complete':
        return success ? 'completed' : 'failed';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }

  private parseResponse(data: DatalabResponse): ConversionJob {
    let content = data.html || data.markdown || data.json || '';

    // Embed base64 images into HTML as data URIs
    if (data.html && data.images) {
      for (const [filename, base64] of Object.entries(data.images)) {
        const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
        const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
        const dataUri = `data:${mimeType};base64,${base64}`;
        // Escape regex special chars in filename
        const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src=["']${escapedFilename}["']`, 'g');
        content = content.replace(regex, `src="${dataUri}"`);
      }
    }

    return {
      jobId: data.request_id,
      status: this.mapStatus(data.status, data.success),
      result:
        data.status === 'complete' && data.success
          ? { content, metadata: {} }
          : undefined,
      error: data.error,
    };
  }

  supportsStreaming(): boolean {
    return false;
  }

  async handleWebhook(request: Request): Promise<ConversionJob> {
    const data = (await request.json()) as DatalabResponse;
    return this.parseResponse(data);
  }
}

/**
 * Create Datalab backend from environment.
 */
export function createDatalabBackend(env: {
  DATALAB_API_KEY?: string;
  WEBHOOK_BASE_URL?: string;
}): DatalabBackend {
  if (!env.DATALAB_API_KEY) {
    throw new Error('Datalab backend requires DATALAB_API_KEY');
  }

  return new DatalabBackend({
    apiKey: env.DATALAB_API_KEY,
    webhookUrl: env.WEBHOOK_BASE_URL ? `${env.WEBHOOK_BASE_URL}/webhooks/datalab` : undefined,
  });
}
