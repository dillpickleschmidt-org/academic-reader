import { AwsClient } from "aws4fetch"
import { readFileSync, existsSync } from "fs"
import { extname } from "path"
import type { UploadResult, PresignedUrlResult } from "../types"

const TUNNEL_URL_FILE = "/tunnel/url"

export interface S3Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

/**
 * S3-compatible storage.
 * Works with Cloudflare R2, MinIO, AWS S3, and other S3-compatible services.
 */
export class S3Storage {
  readonly name = "s3"
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

  private generateKey(filename: string): { fileId: string; key: string } {
    const fileId = crypto.randomUUID()
    const ext = extname(filename).slice(1).toLowerCase() || "pdf"
    return { fileId, key: `uploads/${fileId}.${ext}` }
  }

  async uploadFile(
    file: ArrayBuffer,
    filename: string,
    contentType: string,
  ): Promise<UploadResult> {
    const { fileId, key } = this.generateKey(filename)

    const url = this.getObjectUrl(key)

    const response = await this.client.fetch(url.toString(), {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": contentType,
        "x-amz-meta-original-filename": encodeURIComponent(filename),
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`S3 upload failed: ${error}`)
    }

    return {
      fileId,
      filename,
      size: file.byteLength,
    }
  }

  async getPresignedUploadUrl(filename: string): Promise<PresignedUrlResult> {
    const { fileId, key } = this.generateKey(filename)
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
      fileId,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }
  }

  private getTunnelUrl(): string | undefined {
    try {
      if (existsSync(TUNNEL_URL_FILE)) {
        const url = readFileSync(TUNNEL_URL_FILE, "utf-8").trim()
        if (url) return url
      }
    } catch {}
    return undefined
  }

  async getFileUrl(fileId: string): Promise<string> {
    const key = await this.findFileKey(fileId)
    const url = this.getObjectUrl(key)

    const tunnelUrl = this.getTunnelUrl()
    if (tunnelUrl) {
      return `${tunnelUrl}/${this.config.bucket}/${key}`
    }

    const signedRequest = await this.client.sign(
      new Request(url.toString(), { method: "GET" }),
      { aws: { signQuery: true } },
    )

    return signedRequest.url
  }

  private async findFileKey(fileId: string): Promise<string> {
    const prefix = `uploads/${fileId}`
    const url = new URL(`${this.config.endpoint}/${this.config.bucket}`)
    url.searchParams.set("list-type", "2")
    url.searchParams.set("prefix", prefix)
    url.searchParams.set("max-keys", "1")

    const response = await this.client.fetch(url.toString(), {
      method: "GET",
    })

    if (!response.ok) {
      throw new Error(`S3 list failed: ${await response.text()}`)
    }

    const xml = await response.text()
    const keyMatch = xml.match(/<Key>([^<]+)<\/Key>/)

    if (!keyMatch) {
      throw new Error(`File not found: ${fileId}`)
    }

    return keyMatch[1]
  }
}
