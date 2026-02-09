import { Context, Effect, Layer } from "effect"
import { AwsClient } from "aws4fetch"
import { StorageError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"

export function getDocumentPath(fileId: string, userId?: string): string {
  return userId ? `documents/${userId}/${fileId}` : `temp_documents/${fileId}`
}

export interface SaveFileOptions {
  contentType?: string
  cacheControl?: string
}

export interface StorageService {
  saveFile(
    key: string,
    content: string | Buffer,
    options?: SaveFileOptions,
  ): Effect.Effect<void, StorageError>
  readFile(key: string): Effect.Effect<Buffer, StorageError>
  readFileAsString(key: string): Effect.Effect<string, StorageError>
  exists(key: string): Effect.Effect<boolean, StorageError>
  deleteFile(key: string): Effect.Effect<boolean, StorageError>
  deletePrefix(prefix: string): Effect.Effect<number, StorageError>
  copyPrefix(
    srcPrefix: string,
    dstPrefix: string,
  ): Effect.Effect<number, StorageError>
  getFileUrl(
    key: string,
    internal?: boolean,
  ): Effect.Effect<string, StorageError>
  getPresignedUploadUrl(
    key: string,
  ): Effect.Effect<{ uploadUrl: string; expiresAt: string }, StorageError>
  uploadImages(
    docPath: string,
    images: Record<string, string>,
  ): Effect.Effect<Record<string, string>, StorageError>
}

export class Storage extends Context.Tag("Storage")<Storage, StorageService>() {
  static Live = Layer.effect(
    Storage,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const { s3 } = config
      const client = new AwsClient({
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        service: "s3",
      })

      function getObjectUrl(key: string): URL {
        return new URL(`${s3.endpoint}/${s3.bucket}/${key}`)
      }

      function getTunnelUrl(): string | undefined {
        if (config.backendMode !== "modal") return undefined
        try {
          const { existsSync, readFileSync } = require("fs")
          if (existsSync("/tunnel/url")) {
            const url = readFileSync("/tunnel/url", "utf-8").trim()
            if (url) return url
          }
        } catch {}
        return undefined
      }

      async function waitForTunnelUrl(
        maxWaitMs = 30000,
      ): Promise<string | undefined> {
        if (config.backendMode !== "modal") return undefined
        const startTime = Date.now()
        while (Date.now() - startTime < maxWaitMs) {
          const url = getTunnelUrl()
          if (url) return url
          await new Promise((r) => setTimeout(r, 500))
        }
        console.warn("[S3] Tunnel URL not available after waiting")
        return undefined
      }

      const service: StorageService = {
        saveFile: (key, data, options) =>
          Effect.tryPromise({
            try: async () => {
              const url = getObjectUrl(key)
              const buffer =
                typeof data === "string" ? Buffer.from(data, "utf-8") : data
              const headers: Record<string, string> = {}
              if (options?.contentType)
                headers["Content-Type"] = options.contentType
              if (options?.cacheControl)
                headers["Cache-Control"] = options.cacheControl

              const response = await client.fetch(url.toString(), {
                method: "PUT",
                headers,
                body: new Uint8Array(buffer),
              })
              if (!response.ok) {
                const error = await response.text()
                throw new Error(`S3 save failed: ${error}`)
              }
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        readFile: (key) =>
          Effect.tryPromise({
            try: async () => {
              const response = await client.fetch(
                getObjectUrl(key).toString(),
                { method: "GET" },
              )
              if (!response.ok) {
                const body = await response.text()
                throw new Error(`S3 read failed: ${response.status} - ${body}`)
              }
              return Buffer.from(await response.arrayBuffer())
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        readFileAsString: (key) =>
          Effect.map(service.readFile(key), (buf) => buf.toString("utf-8")),

        exists: (key) =>
          Effect.tryPromise({
            try: async () => {
              const response = await client.fetch(
                getObjectUrl(key).toString(),
                { method: "HEAD" },
              )
              return response.ok
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        deleteFile: (key) =>
          Effect.tryPromise({
            try: async () => {
              const response = await client.fetch(
                getObjectUrl(key).toString(),
                { method: "DELETE" },
              )
              return response.ok || response.status === 404
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        deletePrefix: (prefix) =>
          Effect.tryPromise({
            try: async () => {
              const listUrl = new URL(
                `${s3.endpoint}/${s3.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
              )
              const listResponse = await client.fetch(listUrl.toString(), {
                method: "GET",
              })
              if (!listResponse.ok) return 0

              const xml = await listResponse.text()
              const keys: string[] = []
              for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
                keys.push(match[1])
              }
              if (keys.length === 0) return 0

              await Promise.all(
                keys.map((k) =>
                  client.fetch(getObjectUrl(k).toString(), {
                    method: "DELETE",
                  }),
                ),
              )
              return keys.length
            },
            catch: (e) => new StorageError({ message: String(e), key: prefix }),
          }),

        copyPrefix: (srcPrefix, dstPrefix) =>
          Effect.tryPromise({
            try: async () => {
              const listUrl = new URL(
                `${s3.endpoint}/${s3.bucket}?list-type=2&prefix=${encodeURIComponent(srcPrefix)}`,
              )
              const listResponse = await client.fetch(listUrl.toString(), {
                method: "GET",
              })
              if (!listResponse.ok) return 0

              const xml = await listResponse.text()
              const keys: string[] = []
              for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
                keys.push(match[1])
              }
              if (keys.length === 0) return 0

              await Promise.all(
                keys.map(async (srcKey) => {
                  const suffix = srcKey.slice(srcPrefix.length)
                  const dstKey = `${dstPrefix}${suffix}`
                  await client.fetch(getObjectUrl(dstKey).toString(), {
                    method: "PUT",
                    headers: { "x-amz-copy-source": `/${s3.bucket}/${srcKey}` },
                  })
                }),
              )
              return keys.length
            },
            catch: (e) =>
              new StorageError({ message: String(e), key: srcPrefix }),
          }),

        getFileUrl: (key, internal) =>
          Effect.tryPromise({
            try: async () => {
              if (!internal) {
                const tunnelUrl = getTunnelUrl()
                if (tunnelUrl) return `${tunnelUrl}/${s3.bucket}/${key}`
                return `${s3.publicUrl}/${key}`
              }
              const signedRequest = await client.sign(
                new Request(getObjectUrl(key).toString(), { method: "GET" }),
                { aws: { signQuery: true } },
              )
              return signedRequest.url
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        getPresignedUploadUrl: (key) =>
          Effect.tryPromise({
            try: async () => {
              const expiresInSeconds = 3600
              const tunnelUrl = await waitForTunnelUrl()
              if (tunnelUrl) {
                return {
                  uploadUrl: `${tunnelUrl}/${s3.bucket}/${key}`,
                  expiresAt: new Date(
                    Date.now() + expiresInSeconds * 1000,
                  ).toISOString(),
                }
              }

              const url = getObjectUrl(key)
              url.searchParams.set("X-Amz-Expires", String(expiresInSeconds))
              const signedRequest = await client.sign(
                new Request(url.toString(), { method: "PUT" }),
                { aws: { signQuery: true } },
              )
              return {
                uploadUrl: signedRequest.url,
                expiresAt: new Date(
                  Date.now() + expiresInSeconds * 1000,
                ).toISOString(),
              }
            },
            catch: (e) => new StorageError({ message: String(e), key }),
          }),

        uploadImages: (docPath, images) =>
          Effect.tryPromise({
            try: async () => {
              const baseUrl = s3.publicUrl.replace(/\/+$/, "")
              const entries = await Promise.all(
                Object.entries(images).map(async ([filename, base64Data]) => {
                  const key = `${docPath}/images/${filename}`
                  const buffer = Buffer.from(base64Data, "base64")
                  const ext = filename.split(".").pop()?.toLowerCase() ?? "png"
                  const mimeTypes: Record<string, string> = {
                    png: "image/png",
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                    webp: "image/webp",
                    gif: "image/gif",
                  }

                  const response = await client.fetch(
                    getObjectUrl(key).toString(),
                    {
                      method: "PUT",
                      headers: {
                        "Content-Type": mimeTypes[ext] ?? "image/png",
                        "Cache-Control": "public, max-age=31536000, immutable",
                      },
                      body: new Uint8Array(buffer),
                    },
                  )
                  if (!response.ok) {
                    const error = await response.text()
                    throw new Error(
                      `S3 image upload failed for ${filename}: ${error}`,
                    )
                  }
                  return [filename, `${baseUrl}/${key}`] as const
                }),
              )
              return Object.fromEntries(entries)
            },
            catch: (e) =>
              new StorageError({ message: String(e), key: docPath }),
          }),
      }

      return service
    }),
  )
}
