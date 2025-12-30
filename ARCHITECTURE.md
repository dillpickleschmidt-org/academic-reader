# Architecture Overview

## Deployment Modes

| Mode | Use Case |
|------|----------|
| **Self-hosted** | `docker compose up` - runs everything locally with your GPU |
| **Cloud** | Runpod Serverless + Cloudflare Workers + R2 |

## Cloud Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌─────────────┐
│   Frontend   │────▶│  Cloudflare Worker  │────▶│   Runpod    │
│ (Static/CDN) │     │   (Auth + Storage)  │     │ (Serverless)│
└──────────────┘     └─────────────────────┘     └─────────────┘
                              │  ▲                      │
                              ▼  │ webhook              │
                     ┌─────────────────────┐            │
                     │   Cloudflare R2     │◀───────────┘
                     │  (File Storage)     │   (result)
                     └─────────────────────┘
```

## Components

### Frontend (Static)
- **Host**: Cloudflare Pages / Vercel (free tier)
- **Auth**: WorkOS SDK - handles login, returns JWT
- **Uploads**: Direct to R2 via presigned URL from Worker

### Cloudflare Worker (Thin Backend)
- **Endpoints**:
  - `POST /upload-url` - Validate JWT, return presigned R2 upload URL
  - `POST /convert` - Validate JWT, submit job to Runpod
  - `POST /webhook` - Receive Runpod results, store in R2
  - `GET /files` - List user's converted files
- **Storage**: D1 (SQLite) for user-file associations
- **Auth**: Verify WorkOS JWT on every request

### Runpod Serverless (GPU Compute)
- **Image**: `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04`
- **Handler**: Downloads file from URL, runs conversion, returns result via webhook
- **Scaling**: Zero when idle, spins up on demand (~1-2s cold start)
- **Limits**: Page limit enforced to keep jobs under 100s timeout

### Cloudflare R2 (File Storage)
- **Uploads**: User PDFs (presigned URLs, scoped to user)
- **Results**: Converted HTML/MD/JSON
- **Cost**: Free egress, 10GB free storage

## Self-Hosted Mode

```yaml
# docker-compose.yml
services:
  worker:
    build: ./worker
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    # GPU passthrough, local storage, no auth required
```

- Same conversion code, different entry point
- No Cloudflare/WorkOS - direct API access
- Files stored locally in container volume

## Request Flow (Cloud)

1. **Login**: Frontend → WorkOS → JWT stored in browser
2. **Upload**: Frontend → Worker `/upload-url` → Presigned URL → Direct upload to R2
3. **Convert**: Frontend → Worker `/convert` → Runpod `/run` (async)
4. **Result**: Runpod → Worker `/webhook` → Store result in R2 → Update D1
5. **Fetch**: Frontend polls Worker `/files` → Gets download URL → Fetches from R2

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| URL-based file transfer | Runpod payload limit is 10-20MB |
| Page limit | Keep processing under 100s timeout |
| Webhooks (not polling Runpod) | Cleaner with backend, needed for auth anyway |
| Single Docker image | Same image works local + cloud, PyTorch pre-installed |
| CUDA 11.8 | Compatible with drivers from 2020+, good for self-hosters |

## Costs (Cloud)

| Component | Free Tier | Paid |
|-----------|-----------|------|
| Cloudflare Pages | Unlimited sites | - |
| Cloudflare Workers | 100k req/day | $5/mo unlimited |
| Cloudflare R2 | 10GB storage, free egress | $0.015/GB/mo |
| Cloudflare D1 | 5GB storage | $0.75/GB/mo |
| Runpod Serverless | - | ~$0.01-0.02/conversion |
| WorkOS | 1M MAU free | - |

**Estimated cost for low usage**: $0-5/month
