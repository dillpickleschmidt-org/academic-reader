import { AwsClient } from "aws4fetch"
import { readFileSync, existsSync } from "fs"
import type { PresignedUrlResult } from "../types"
import type { Storage } from "./types"

const TUNNEL_URL_FILE = "/tunnel/url"

export interface S3Config {
  endpoint: string
  publicUrl?: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/**
 * S3-compatible storage.
 * Works with Cloudflare R2, MinIO, AWS S3, and other S3-compatible services.
 */
export class S3Storage implements Storage {
  private config: S3Config
  private client: AwsClient

  constructor(config: S3Config) {
    this.config = config
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
    })
  }

  private getObjectUrl(key: string): URL {
    return new URL(`${this.config.endpoint}/${this.config.bucket}/${key}`)
  }

  /**
   * Get a presigned URL for uploading to a specific key.
   */
  async getPresignedUploadUrl(key: string): Promise<PresignedUrlResult> {
    const url = this.getObjectUrl(key)
    const expiresInSeconds = 3600 // 1 hour

    // Add expiration to URL before signing (aws4fetch includes it in signature)
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds))

    const signedRequest = await this.client.sign(
      new Request(url.toString(), { method: "PUT" }),
      { aws: { signQuery: true } },
    )

    return {
      uploadUrl: signedRequest.url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }
  }

  private getTunnelUrl(): string | undefined {
    try {
      if (existsSync(TUNNEL_URL_FILE)) {
        const url = readFileSync(TUNNEL_URL_FILE, "utf-8").trim()
        if (url) return url
      }
    } catch {
      // Ignore errors reading tunnel file
    }
    return undefined
  }

  async getFileUrl(uploadKey: string): Promise<string> {
    const url = this.getObjectUrl(uploadKey)

    const tunnelUrl = this.getTunnelUrl()
    if (tunnelUrl) {
      return `${tunnelUrl}/${this.config.bucket}/${uploadKey}`
    }

    const signedRequest = await this.client.sign(
      new Request(url.toString(), { method: "GET" }),
      { aws: { signQuery: true } },
    )

    return signedRequest.url
  }

  /**
   * Delete a file from S3 storage.
   * @returns true if deleted successfully or already gone, false on error
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      const url = this.getObjectUrl(key)

      const response = await this.client.fetch(url.toString(), {
        method: "DELETE",
      })

      // 204 = deleted, 404 = already gone - both are success
      return response.ok || response.status === 404
    } catch (error) {
      console.warn(`[S3] Failed to delete file ${key}:`, error)
      return false
    }
  }

  /**
   * Save a file to S3.
   */
  async saveFile(key: string, data: Buffer | string): Promise<void> {
    const url = this.getObjectUrl(key)
    const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data

    const response = await this.client.fetch(url.toString(), {
      method: "PUT",
      body: new Uint8Array(buffer),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`S3 save failed: ${error}`)
    }
  }

  /**
   * Read a file from S3.
   */
  async readFile(key: string): Promise<Buffer> {
    const url = this.getObjectUrl(key)

    const response = await this.client.fetch(url.toString(), {
      method: "GET",
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`S3 read failed: ${response.status} - ${body}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * Read a file as string from S3.
   */
  async readFileAsString(key: string): Promise<string> {
    const buffer = await this.readFile(key)
    return buffer.toString("utf-8")
  }

  /**
   * Check if a file exists.
   */
  async exists(key: string): Promise<boolean> {
    const url = this.getObjectUrl(key)

    const response = await this.client.fetch(url.toString(), {
      method: "HEAD",
    })

    return response.ok
  }

  /**
   * Upload multiple images to storage and return their public URLs.
   * Images are stored at {docPath}/images/{filename}.
   */
  async uploadImages(
    docPath: string,
    images: Record<string, string>,
  ): Promise<Record<string, string>> {
    const CONTENT_TYPES: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    }

    const baseUrl = (this.config.publicUrl ?? this.config.endpoint).replace(
      /\/+$/,
      "",
    )

    const entries = await Promise.all(
      Object.entries(images).map(async ([filename, base64Data]) => {
        const key = `${docPath}/images/${filename}`
        const buffer = Buffer.from(base64Data, "base64")

        const ext = filename.split(".").pop()?.toLowerCase() ?? "png"
        const contentType = CONTENT_TYPES[ext] ?? "image/png"

        const url = this.getObjectUrl(key)
        const response = await this.client.fetch(url.toString(), {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: new Uint8Array(buffer),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`S3 image upload failed for ${filename}: ${error}`)
        }

        return [filename, `${baseUrl}/${this.config.bucket}/${key}`] as const
      }),
    )

    return Object.fromEntries(entries)
  }
}
