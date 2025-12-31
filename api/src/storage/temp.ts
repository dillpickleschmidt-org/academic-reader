/**
 * Temporary file storage for Datalab direct upload.
 * Files are stored between upload and convert requests, then deleted.
 */

export interface TempFile {
  data: ArrayBuffer;
  filename: string;
  contentType: string;
  expiresAt: number;
}

export interface TempStorage {
  store(id: string, file: TempFile): Promise<void>;
  retrieve(id: string): Promise<TempFile | null>;
  delete(id: string): Promise<void>;
}

/**
 * In-memory temp storage for self-hosted deployments.
 * Files are stored in memory with TTL-based cleanup.
 */
export class MemoryTempStorage implements TempStorage {
  private files = new Map<string, TempFile>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs = 60000) {
    // Cleanup expired files periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async store(id: string, file: TempFile): Promise<void> {
    this.files.set(id, file);
  }

  async retrieve(id: string): Promise<TempFile | null> {
    const file = this.files.get(id);
    if (!file) return null;

    // Check if expired
    if (Date.now() > file.expiresAt) {
      this.files.delete(id);
      return null;
    }

    return file;
  }

  async delete(id: string): Promise<void> {
    this.files.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, file] of this.files.entries()) {
      if (now > file.expiresAt) {
        this.files.delete(id);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.files.clear();
  }
}

/**
 * KV-backed temp storage for Cloudflare Workers.
 * Uses KV with TTL for automatic cleanup.
 */
export class KVTempStorage implements TempStorage {
  constructor(private kv: KVNamespace) {}

  async store(id: string, file: TempFile): Promise<void> {
    // KV can't store ArrayBuffer directly, so we base64 encode
    const base64Data = arrayBufferToBase64(file.data);

    const ttlSeconds = Math.max(1, Math.floor((file.expiresAt - Date.now()) / 1000));

    await this.kv.put(
      `temp:${id}`,
      JSON.stringify({
        data: base64Data,
        filename: file.filename,
        contentType: file.contentType,
      }),
      { expirationTtl: ttlSeconds }
    );
  }

  async retrieve(id: string): Promise<TempFile | null> {
    const stored = await this.kv.get(`temp:${id}`);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as {
      data: string;
      filename: string;
      contentType: string;
    };

    return {
      data: base64ToArrayBuffer(parsed.data),
      filename: parsed.filename,
      contentType: parsed.contentType,
      expiresAt: 0, // Not needed for KV (handled by TTL)
    };
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(`temp:${id}`);
  }
}

// Helper functions for base64 encoding/decoding
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
