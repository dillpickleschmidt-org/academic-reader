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
| Hosted      | `runpod`  | Cloudflare R2 <sub>(requires cloudflare account)</sub>                                    |
| Hosted      | `datalab` | Cloudflare KV (temp), uploaded directly to Datalab API                                    |

## Commands

```bash
bun run dev            # Start dev servers
bun run config:status  # Show current config
bun run deploy         # Deploy to Cloudflare
```

## Configuration

| Variable             | Required        | Description                            |
| -------------------- | --------------- | -------------------------------------- |
| `BACKEND_MODE`       | Yes             | `local`, `runpod`, or `datalab`        |
| `DATALAB_API_KEY`    | datalab         | From [datalab.to](https://datalab.to)  |
| `RUNPOD_API_KEY`     | runpod          | From Runpod dashboard                  |
| `RUNPOD_ENDPOINT_ID` | runpod          | Your endpoint ID                       |
| `S3_ENDPOINT`        | runpod (hosted) | Cloudflare R2 endpoint (S3-compatible) |
| `S3_ACCESS_KEY`      | runpod (hosted) | R2 access key (S3-compatible)          |
| `S3_SECRET_KEY`      | runpod (hosted) | R2 secret key (S3-compatible)          |
| `S3_BUCKET`          | runpod (hosted) | R2 bucket name (S3-compatible)         |

See `.env.example` for all options.

## Authentication

| Environment         | Convex Backend                     | Setup Required                |
| ------------------- | ---------------------------------- | ----------------------------- |
| Development         | Self-hosted (Docker)               | None - starts automatically   |
| Production (deploy) | [Convex Cloud](https://convex.dev) | Convex account + Google OAuth |

**Development (`bun run dev`):** All modes (local, runpod, datalab) use self-hosted Convex via Docker - no account needed. A Convex dashboard is available at <http://localhost:6791> for browsing data when run with the `--dashboard` flag.

**Production (`bun run deploy`):** Requires Convex Cloud. Run `bunx convex deploy` in `frontend/` to create a production deployment, then add `CONVEX_DEPLOYMENT` and `CONVEX_URL` to `.env.local`. Also add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for OAuth.
