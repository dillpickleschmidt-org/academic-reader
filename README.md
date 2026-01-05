# Academic Reader

PDF → readable HTML converter using [Marker](https://github.com/datalab-to/marker).

Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

## Quick Start

```bash
cp .env.example .env.local   # Configure API keys
bun run dev                  # Start development servers
```

## Backend Modes

| Mode      | GPU           | File Storage     | Setup                      |
| --------- | ------------- | ---------------- | -------------------------- |
| `local`   | Your machine  | Local filesystem | NVIDIA GPU + Docker        |
| `runpod`  | Runpod cloud  | S3/R2/MinIO      | Runpod API key + S3 config |
| `datalab` | Datalab cloud | Memory (temp)    | Datalab API key            |

Set `DEV_BACKEND_MODE` in `.env.local` for development.

## Development

```bash
bun run dev            # Start with mode from .env.local
bun run dev:local      # Override to local mode
bun run dev:datalab    # Override to datalab mode
bun run dev:runpod     # Override to runpod mode
```

Add `--dashboard` to enable Convex dashboard at localhost:6791.

All modes use self-hosted Convex via Docker - no account needed.

## Production Deployment

### Prerequisites

1. VPS with Docker installed (e.g., Hetzner)
2. Domain with DNS on Cloudflare
3. Cloudflare Pages project

### Initial VPS Setup

```bash
ssh root@<your-vps-ip>
git clone <your-repo> /root/academic-reader
```

### Configure & Deploy

```bash
# In .env.local, set:
# - PROD_BACKEND_MODE=datalab (or runpod)
# - PROD_VPS_HOST_IP, PROD_VPS_USER, PROD_VPS_PATH
# - PROD_DOMAIN=yourdomain.com
# - PROD_CLOUDFLARE_PROJECT
# - API keys for your chosen backend mode

bun run deploy
```

This will:

1. Sync environment to VPS
2. Pull latest code and restart Docker (API + Convex + Dashboard)
3. Build frontend with production URLs
4. Deploy frontend to Cloudflare Pages

### DNS Setup (Cloudflare)

Create proxied A records pointing to your VPS:

- `api.yourdomain.com`
- `convex.yourdomain.com`
- `convex-site.yourdomain.com`

## Configuration

### Development

| Variable             | Required     | Description                            |
| -------------------- | ------------ | -------------------------------------- |
| `DEV_BACKEND_MODE`   | Yes          | `local`, `runpod`, or `datalab`        |
| `SITE_URL`           | Yes          | Frontend URL (default: localhost:5173) |
| `DATALAB_API_KEY`    | datalab      | From [datalab.to](https://datalab.to)  |
| `RUNPOD_API_KEY`     | runpod       | From Runpod dashboard                  |
| `RUNPOD_ENDPOINT_ID` | runpod       | Your endpoint ID                       |
| `GOOGLE_API_KEY`     | local/runpod | For Gemini API                         |

### Production

| Variable                  | Required | Description                     |
| ------------------------- | -------- | ------------------------------- |
| `PROD_BACKEND_MODE`       | Yes      | `datalab` or `runpod`           |
| `PROD_VPS_HOST_IP`        | Yes      | VPS IP address                  |
| `PROD_VPS_USER`           | Yes      | SSH user (default: root)        |
| `PROD_VPS_PATH`           | Yes      | Repo path on VPS                |
| `PROD_DOMAIN`             | Yes      | Your domain (e.g., example.com) |
| `PROD_CLOUDFLARE_PROJECT` | Yes      | Cloudflare Pages project name   |
| `PROD_S3_*`               | runpod   | S3/R2 credentials for runpod    |

### Shared (dev & prod)

| Variable               | Required | Description                |
| ---------------------- | -------- | -------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth    | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | OAuth    | Google OAuth client secret |

See `.env.example` for all options.
