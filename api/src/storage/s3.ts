import { AwsClient } from 'aws4fetch';
import { readFileSync, existsSync } from 'fs';
import type { StorageAdapter, UploadResult, PresignedUrlResult } from './interface';

const TUNNEL_URL_FILE = '/tunnel/url';

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl?: string; // Optional public URL for self-hosted (e.g., tunnel URL)
}

/**
 * S3-compatible storage adapter.
 * Works with Cloudflare R2, MinIO, AWS S3, and other S3-compatible services.
 */
export class S3Storage implements StorageAdapter {
  readonly name = 's3';
  private config: S3Config;
  private client: AwsClient;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
    });
  }

  private getObjectUrl(key: string): URL {
    return new URL(`${this.config.endpoint}/${this.config.bucket}/${key}`);
  }

  async uploadFile(file: ArrayBuffer, filename: string, contentType: string): Promise<UploadResult> {
    const fileId = crypto.randomUUID();
    const ext = filename.split('.').pop() || 'pdf';
    const key = `uploads/${fileId}.${ext}`;

    const url = this.getObjectUrl(key);

    const response = await this.client.fetch(url.toString(), {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': contentType,
        'x-amz-meta-original-filename': encodeURIComponent(filename),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`S3 upload failed: ${error}`);
    }

    return {
      fileId,
      filename,
      size: file.byteLength,
    };
  }

  async getPresignedUploadUrl(filename: string): Promise<PresignedUrlResult> {
    const fileId = crypto.randomUUID();
    const ext = filename.split('.').pop() || 'pdf';
    const key = `uploads/${fileId}.${ext}`;

    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const url = this.getObjectUrl(key);

    const signedRequest = await this.client.sign(
      new Request(url, { method: 'PUT' }),
      { aws: { signQuery: true } }
    );

    return {
      uploadUrl: signedRequest.url,
      fileId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private getPublicUrl(): string | undefined {
    if (this.config.publicUrl) return this.config.publicUrl;

    try {
      if (existsSync(TUNNEL_URL_FILE)) {
        const url = readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
        if (url) return url;
      }
    } catch {}

    return undefined;
  }

  async getFileUrl(fileId: string): Promise<string> {
    const key = await this.findFileKey(fileId);
    const url = this.getObjectUrl(key);

    const publicUrl = this.getPublicUrl();
    if (publicUrl) {
      return `${publicUrl}/${this.config.bucket}/${key}`;
    }

    const signedRequest = await this.client.sign(
      new Request(url, { method: 'GET' }),
      { aws: { signQuery: true } }
    );

    return signedRequest.url;
  }

  private async findFileKey(fileId: string): Promise<string> {
    const prefix = `uploads/${fileId}`;
    const url = new URL(`${this.config.endpoint}/${this.config.bucket}`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('max-keys', '1');

    const response = await this.client.fetch(url.toString(), {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`S3 list failed: ${await response.text()}`);
    }

    const xml = await response.text();
    const keyMatch = xml.match(/<Key>([^<]+)<\/Key>/);

    if (!keyMatch) {
      throw new Error(`File not found: ${fileId}`);
    }

    return keyMatch[1];
  }

}
