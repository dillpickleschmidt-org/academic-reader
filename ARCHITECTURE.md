# Architecture

## Repository Structure

```
academic-reader/
├── package.json          # Bun workspace root
├── frontend/             # React + Vite (Cloudflare Pages)
├── api/                  # Cloudflare Worker (API gateway)
└── worker/               # Python FastAPI + Marker (Docker/Runpod)
```

## Deployment Modes

| Mode | Frontend | API | GPU Worker |
|------|----------|-----|------------|
| **Local Dev** | `bun run dev` | Direct to worker | `docker compose up` |
| **Cloud (Runpod)** | Cloudflare Pages | Cloudflare Worker | Runpod Serverless |
| **Cloud (Datalab)** | Cloudflare Pages | Cloudflare Worker | Datalab API |

## Cloud Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   Frontend   │────▶│  Cloudflare Worker  │────▶│ Runpod/Datalab  │
│    (Pages)   │     │    (API Gateway)    │     │   (GPU/API)     │
└──────────────┘     └─────────────────────┘     └─────────────────┘
                              │                         │
                              ▼                         │ webhook
                     ┌─────────────────────┐            │
                     │    Cloudflare R2    │◀───────────┘
                     │   (File Storage)    │
                     └─────────────────────┘
```

## API Gateway (Cloudflare Worker)

The `/api` package routes requests to one of three backends:

| Backend | Config | Use Case |
|---------|--------|----------|
| `local` | `CONVERSION_BACKEND=local` | Development |
| `runpod` | `CONVERSION_BACKEND=runpod` | Self-hosted GPU |
| `datalab` | `CONVERSION_BACKEND=datalab` | Hosted Marker API |

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /upload` | Upload file to R2 |
| `POST /convert/:fileId` | Start conversion job |
| `GET /jobs/:jobId` | Poll job status |
| `GET /jobs/:jobId/stream` | SSE progress stream |
| `POST /webhooks/runpod` | Runpod completion callback |

### Storage

- **R2**: PDF uploads, conversion results
- **KV**: Job state (24hr TTL)

## Local Development

```bash
# All-in-one (starts frontend, API, and worker based on mode)
bun run dev

# Or specify a mode explicitly
bun run dev:local    # Uses local Docker GPU worker
bun run dev:runpod   # Uses Runpod serverless
bun run dev:datalab  # Uses Datalab API
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start full dev environment |
| `bun run dev:local` | Dev with local Docker worker |
| `bun run dev:runpod` | Dev with Runpod backend |
| `bun run dev:datalab` | Dev with Datalab backend |
| `bun run deploy` | Deploy to Cloudflare |
| `bun run config:status` | Check configuration status |
| `bun run config:sync` | Sync env to wrangler secrets |
| `bun run build` | Build frontend |
| `bun run typecheck` | Typecheck all packages |
