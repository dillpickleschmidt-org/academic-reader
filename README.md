# Academic Reader

PDF → readable HTML converter using [Marker](https://github.com/datalab-to/marker).

Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

## Quick Start

```bash
cp .env.example .env.local   # Set BACKEND_MODE + API keys
bun run config:status        # Check your api keys
bun run dev                  # Start
```

## Deployment Modes

### Self-Hosted

| Mode      | GPU           | File Storage     | Setup                       |
| --------- | ------------- | ---------------- | --------------------------- |
| `local`   | Your machine  | Local filesystem | NVIDIA GPU                  |
| `runpod`  | Runpod cloud  | S3/MinIO         | Runpod API key and endpoint |
| `datalab` | Datalab cloud | Memory (temp)    | Datalab API key             |

### Hosted Website (deploy to Cloudflare)

| Mode      | GPU           | File Storage         | Setup                      |
| --------- | ------------- | -------------------- | -------------------------- |
| `runpod`  | Runpod cloud  | S3/R2                | Runpod API key + S3 config |
| `datalab` | Datalab cloud | Cloudflare KV (temp) | Datalab API key            |

Set `BACKEND_MODE` in `.env.local` to `local`, `runpod`, or `datalab`.

## File Storage

| Deployment  | Mode      | Where input files go                                                                      |
| ----------- | --------- | ----------------------------------------------------------------------------------------- |
| Self-hosted | `local`   | `worker/uploads/` on your machine                                                         |
| Self-hosted | `runpod`  | MinIO (local S3) via cloudflared tunnel <sub>(temp anonymous URL, no auth required)</sub> |
| Self-hosted | `datalab` | Uploaded directly to Datalab API                                                          |
| Hosted      | `runpod`  | Cloudflare R2                                                                             |
| Hosted      | `datalab` | Cloudflare KV (temp), uploaded directly to Datalab API                                    |

## Commands

```bash
bun run dev            # Start dev servers
bun run config:status  # Show current config
bun run deploy         # Deploy to Cloudflare
```

## Configuration

| Variable             | Required        | Description                           |
| -------------------- | --------------- | ------------------------------------- |
| `BACKEND_MODE`       | Yes             | `local`, `runpod`, or `datalab`       |
| `DATALAB_API_KEY`    | datalab         | From [datalab.to](https://datalab.to) |
| `RUNPOD_API_KEY`     | runpod          | From Runpod dashboard                 |
| `RUNPOD_ENDPOINT_ID` | runpod          | Your endpoint ID                      |
| `S3_ENDPOINT`        | runpod (hosted) | S3-compatible endpoint                |
| `S3_ACCESS_KEY`      | runpod (hosted) | S3 access key                         |
| `S3_SECRET_KEY`      | runpod (hosted) | S3 secret key                         |
| `S3_BUCKET`          | runpod (hosted) | Bucket name                           |

See `.env.example` for all options.
