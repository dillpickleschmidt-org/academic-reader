import { Context, Effect, Layer } from "effect"
import { AwsClient } from "aws4fetch"
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import { StorageError } from "@academic-reader/api-client/errors"
import { AppConfig } from "../config"

const tunnelUrlPath = resolve(
  import.meta.dirname,
  "../../../../.infra/tunnel/url",
)

interface SaveFileOptions {
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
  deleteFile(key: string): Effect.Effect<boolean, StorageError>
  deletePrefix(prefix: string): Effect.Effect<number, StorageError>
  copyPrefix(
    srcPrefix: string,
    dstPrefix: string,
  ): Effect.Effect<number, StorageError>
  getPresignedReadUrl(key: string): Effect.Effect<string, StorageError>
  getPresignedUploadUrl(
    key: string,
  ): Effect.Effect<{ uploadUrl: string; expiresAt: string }, StorageError>
}

export class Storage extends Context.Service<Storage, StorageService>()(
  "Storage",
) {
  static layer = Layer.effect(
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
        return new URL(`${s3.apiEndpoint}/${s3.bucket}/${key}`)
      }

      function getPresignedObjectUrl(key: string): URL {
        return new URL(`${s3.presignedUrlEndpoint}/${s3.bucket}/${key}`)
      }

      function getTunnelUrl(): string | undefined {
        if (config.conversionBackend !== "modal") return undefined
        try {
          if (existsSync(tunnelUrlPath)) {
            const url = readFileSync(tunnelUrlPath, "utf-8").trim()
            if (url) return url
          }
        } catch {}
        return undefined
      }

      async function waitForTunnelUrl(
        maxWaitMs = 30000,
      ): Promise<string | undefined> {
        if (config.conversionBackend !== "modal") return undefined
        const startTime = Date.now()
        while (Date.now() - startTime < maxWaitMs) {
          const url = getTunnelUrl()
          if (url) return url
          await new Promise((r) => setTimeout(r, 500))
        }
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
                `${s3.apiEndpoint}/${s3.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
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
                `${s3.apiEndpoint}/${s3.bucket}?list-type=2&prefix=${encodeURIComponent(srcPrefix)}`,
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

        getPresignedReadUrl: (key) =>
          Effect.tryPromise({
            try: async () => {
              const tunnelUrl = getTunnelUrl()
              const url = tunnelUrl
                ? new URL(`${tunnelUrl}/${s3.bucket}/${key}`)
                : getPresignedObjectUrl(key)
              const signedRequest = await client.sign(
                new Request(url.toString(), { method: "GET" }),
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
              const url = tunnelUrl
                ? new URL(`${tunnelUrl}/${s3.bucket}/${key}`)
                : getPresignedObjectUrl(key)
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
      }

      return service
    }),
  )
}
