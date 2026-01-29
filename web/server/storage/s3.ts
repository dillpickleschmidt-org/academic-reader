import { AwsClient } from "aws4fetch"
import { readFileSync, existsSync } from "fs"
import type { PresignedUrlResult } from "../types"
import type { Storage, SaveFileOptions } from "./types"
import { getImageMimeType } from "../utils/mime-types"
import { env } from "../env"

const TUNNEL_URL_FILE = "/tunnel/url"

export interface S3Config {
  endpoint: string
  publicUrl: string
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

  private getTunnelUrl(): string | undefined {
    if (env.BACKEND_MODE !== "modal") return undefined
    try {
      if (existsSync(TUNNEL_URL_FILE)) {
        const url = readFileSync(TUNNEL_URL_FILE, "utf-8").trim()
        if (url) return url
      }
    } catch {}
    return undefined
  }

  private async waitForTunnelUrl(maxWaitMs = 30000): Promise<string | undefined> {
    if (env.BACKEND_MODE !== "modal") return undefined

    const startTime = Date.now()
    while (Date.now() - startTime < maxWaitMs) {
      const url = this.getTunnelUrl()
      if (url) return url
      await new Promise((r) => setTimeout(r, 500))
    }
    console.warn("[S3] Tunnel URL not available after waiting")
    return undefined
  }

  /**
   * Get a presigned URL for uploading to a specific key.
   * In modal mode, uses tunnel URL so external workers can reach MinIO.
   */
  async getPresignedUploadUrl(key: string): Promise<PresignedUrlResult> {
    const expiresInSeconds = 3600 // 1 hour

    // In modal mode, use tunnel URL for external worker access
    const tunnelUrl = await this.waitForTunnelUrl()
    if (tunnelUrl) {
      return {
        uploadUrl: `${tunnelUrl}/${this.config.bucket}/${key}`,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      }
    }

    // Fallback to presigned S3 URL
    const url = this.getObjectUrl(key)
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

  async getFileUrl(uploadKey: string, internal?: boolean): Promise<string> {
    if (!internal) {
      const tunnelUrl = this.getTunnelUrl()
      if (tunnelUrl) {
        return `${tunnelUrl}/${this.config.bucket}/${uploadKey}`
      }
      return `${this.config.publicUrl}/${uploadKey}`
    }

    const signedRequest = await this.client.sign(
      new Request(this.getObjectUrl(uploadKey).toString(), { method: "GET" }),
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
  async saveFile(
    key: string,
    data: Buffer | string,
    options?: SaveFileOptions,
  ): Promise<void> {
    const url = this.getObjectUrl(key)
    const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data

    const headers: Record<string, string> = {}
    if (options?.contentType) {
      headers["Content-Type"] = options.contentType
    }
    if (options?.cacheControl) {
      headers["Cache-Control"] = options.cacheControl
    }

    const response = await this.client.fetch(url.toString(), {
      method: "PUT",
      headers,
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
    const baseUrl = this.config.publicUrl.replace(/\/+$/, "")

    const entries = await Promise.all(
      Object.entries(images).map(async ([filename, base64Data]) => {
        const key = `${docPath}/images/${filename}`
        const buffer = Buffer.from(base64Data, "base64")

        const url = this.getObjectUrl(key)
        const response = await this.client.fetch(url.toString(), {
          method: "PUT",
          headers: {
            "Content-Type": getImageMimeType(filename),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: new Uint8Array(buffer),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`S3 image upload failed for ${filename}: ${error}`)
        }

        return [filename, `${baseUrl}/${key}`] as const
      }),
    )

    return Object.fromEntries(entries)
  }

  /**
   * Delete all files with a given prefix.
   * Used for cleaning up document folders including audio files.
   * @returns Number of files deleted
   */
  async deletePrefix(prefix: string): Promise<number> {
    try {
      // List objects with prefix
      const listUrl = new URL(
        `${this.config.endpoint}/${this.config.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
      )

      const listResponse = await this.client.fetch(listUrl.toString(), {
        method: "GET",
      })

      if (!listResponse.ok) {
        console.warn(`[S3] Failed to list files with prefix ${prefix}`)
        return 0
      }

      const xml = await listResponse.text()

      // Parse keys from XML response
      const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g)
      const keys: string[] = []
      for (const match of keyMatches) {
        keys.push(match[1])
      }

      if (keys.length === 0) {
        return 0
      }

      // Delete each file
      await Promise.all(keys.map((key) => this.deleteFile(key)))

      return keys.length
    } catch (error) {
      console.warn(`[S3] Failed to delete prefix ${prefix}:`, error)
      return 0
    }
  }

  /**
   * Copy all files from srcPrefix to dstPrefix.
   * Used for migrating files from temp storage to user storage.
   * @returns Number of files copied
   */
  async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<number> {
    try {
      // List objects with prefix
      const listUrl = new URL(
        `${this.config.endpoint}/${this.config.bucket}?list-type=2&prefix=${encodeURIComponent(srcPrefix)}`,
      )

      const listResponse = await this.client.fetch(listUrl.toString(), {
        method: "GET",
      })

      if (!listResponse.ok) {
        console.warn(`[S3] Failed to list files with prefix ${srcPrefix}`)
        return 0
      }

      const xml = await listResponse.text()

      // Parse keys from XML response
      const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g)
      const keys: string[] = []
      for (const match of keyMatches) {
        keys.push(match[1])
      }

      if (keys.length === 0) {
        return 0
      }

      // Copy each file using S3 copy operation
      await Promise.all(
        keys.map(async (srcKey) => {
          const suffix = srcKey.slice(srcPrefix.length)
          const dstKey = `${dstPrefix}${suffix}`
          const dstUrl = this.getObjectUrl(dstKey)

          const response = await this.client.fetch(dstUrl.toString(), {
            method: "PUT",
            headers: {
              "x-amz-copy-source": `/${this.config.bucket}/${srcKey}`,
            },
          })

          if (!response.ok) {
            console.warn(`[S3] Failed to copy ${srcKey} to ${dstKey}`)
          }
        }),
      )

      return keys.length
    } catch (error) {
      console.warn(`[S3] Failed to copy prefix ${srcPrefix}:`, error)
      return 0
    }
  }
}
