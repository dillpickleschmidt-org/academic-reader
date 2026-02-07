# Academic Reader

PDF → readable HTML converter using [Marker](https://github.com/datalab-to/marker).

Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

## Quick Start

```bash
cp .env.local.example .env.local   # Configure dev environment
bun run dev                        # Start development servers
```

## Backend Modes

| Mode      | GPU           | File Storage | Setup                      |
| --------- | ------------- | ------------ | -------------------------- |
| `local`   | Your machine  | MinIO        | NVIDIA GPU + Docker        |
| `datalab` | Datalab cloud | MinIO / R2   | Datalab API key            |
| `modal`   | Modal cloud   | MinIO / R2   | Modal account + S3 config  |

Set `BACKEND_MODE` in `.env.local` for development.

### Backend Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Server (Hono)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  BACKEND_MODE=local       │  BACKEND_MODE=datalab    │  BACKEND_MODE=modal  │
│  ───────────────────────  │  ──────────────────────  │  ────────────────────│
│  LocalBackend             │  DatalabBackend          │  ModalBackend        │
│  - Docker: marker         │  - Datalab API           │  - Modal: marker     │
│  - Docker: lightonocr     │                          │  - Modal: lightonocr │
│  LocalTTSBackend          │  ModalTTSBackend         │  - Modal: chandra    │
│  - Docker: kokoro         │  - Modal: kokoro         │  ModalTTSBackend     │
│  - Docker: qwen3          │  - Modal: qwen3          │  - Modal: kokoro     │
│                           │                          │  - Modal: qwen3      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Workers:**
- `marker` - Fast PDF/document conversion (Marker)
- `lightonocr` - Balanced OCR conversion (LightOnOCR + vLLM)
- `chandra` - Aggressive OCR conversion (CHANDRA + vLLM)
- `kokoro` - TTS synthesis (Kokoro - female voices)
- `qwen3` - TTS synthesis (Qwen3-TTS - male voices)

## Deployment Architecture

```
                                 Browser
                                    │
                                    ▼
                           Cloudflare (proxy/protection)
                                    │
                                    ▼
                             VPS port 443
                                    │
                                    ▼
                          Traefik (Dokploy's proxy)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
            Host: academic-reader.com    Host: convex-api.academic-reader.com
                    │                               │
                    ▼                               ▼
              app container               convex-backend container
                    │
                    ▼
        ┌────────── OR ──────────┐
        │                        │
     Datalab               Modal ◀──▶ S3/R2
```

Frontend and API served from VPS via Dokploy. Cloudflare proxy provides DDoS protection and caching.

### API Endpoints

| Endpoint                      | Purpose                     |
| ----------------------------- | --------------------------- |
| `POST /api/upload`            | Upload file (to S3 or temp) |
| `POST /api/convert/:fileId`   | Start conversion job        |
| `GET /api/jobs/:jobId/stream` | SSE progress stream         |
| `GET /api/files/:fileId/download` | Download converted HTML |
| `GET /api/auth/*`             | Auth (proxied to Convex)    |

### Storage

All modes use S3-compatible storage (MinIO for dev, R2 for prod):

- **Signed-out users**: `temp_documents/{fileId}/` - auto-deleted after 7 days
- **Signed-in users**: `documents/{userId}/{fileId}/` - permanent, managed via UI

Each document folder contains: `original.pdf`, `content.html`, `content.md`

## Development

```bash
bun run dev            # Start with mode from .env.local
bun run dev:local      # Override to local mode
bun run dev:datalab    # Override to datalab mode
bun run dev:modal      # Override to modal mode
```

Add `--dashboard` to enable Convex dashboard at localhost:6791.

All modes use self-hosted Convex via Docker - no account needed.

## Production Deployment

Production uses [Dokploy](https://dokploy.com) for container orchestration with automatic deployments via GitHub Actions.

### Prerequisites

1. VPS with Dokploy installed
2. Domain with DNS on Cloudflare (proxy enabled)
3. Docker Hub account

### Deployment Flow

```
Push to main
    │
    ├─► GitHub Actions builds image
    │   └─► Pushes to Docker Hub
    │       └─► Dokploy detects new tag and redeploys
    │
    └─► If frontend/convex/* changed
        └─► GitHub Actions deploys Convex functions
```

### Initial Setup

1. **Install Dokploy on VPS**

   ```bash
   curl -sSL https://dokploy.com/install.sh | sh
   ```

2. **Deploy Convex** (via Dokploy Compose with the self-hosted Convex blueprint)

3. **Deploy App** (via Dokploy Docker Image from Docker Hub)

4. **Configure domains** in Dokploy:
   - `yourdomain.com` → app container (port 8787)
   - `convex.yourdomain.com` → convex-backend (port 3210)

5. **Set up Cloudflare DNS**:

   ```
   A    @        <VPS_IP>    Proxied
   A    convex   <VPS_IP>    Proxied
   ```

6. **Generate Convex admin key**:

   ```bash
   docker exec <convex-container> ./generate_admin_key.sh
   ```

7. **Add GitHub Secrets**:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
   - `CONVEX_ADMIN_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `BETTER_AUTH_SECRET`

8. **Configure R2 lifecycle rule** (modal mode):

   ```bash
   # Auto-delete temp files after 7 days (signed-out user uploads)
   npx wrangler r2 bucket lifecycle add <bucket-name> temp-cleanup temp_documents/ --expire-days 7
   ```

9. **Configure SSRF protection** (required for `/fetch-url` endpoint):

   ```bash
   # Block containers from accessing private/internal IPs (IPv4)
   iptables -I DOCKER-USER -d 169.254.0.0/16 -j REJECT  # Metadata/link-local
   iptables -I DOCKER-USER -d 127.0.0.0/8 -j REJECT     # Localhost
   iptables -I DOCKER-USER -d 10.0.0.0/8 -j REJECT      # Private
   iptables -I DOCKER-USER -d 192.168.0.0/16 -j REJECT  # Private

   # Block IPv6 private ranges
   ip6tables -I DOCKER-USER -d ::1 -j REJECT            # Localhost
   ip6tables -I DOCKER-USER -d fc00::/7 -j REJECT       # Private (ULA)
   ip6tables -I DOCKER-USER -d fe80::/10 -j REJECT      # Link-local

   # Persist across reboots
   apt install -y iptables-persistent
   netfilter-persistent save
   ```

   This prevents the URL fetch endpoint from being used to access internal services.

### Convex Dashboard

The dashboard is not publicly exposed. Access options:

- Via Tailscale: `http://your-vps-tailscale-hostname:6791`
- Via SSH tunnel: `ssh -L 6791:localhost:6791 user@your-vps`

### Monitoring (Optional)

For structured logging via Grafana/Loki:

1. Deploy [dokploy-grafana-compose](https://github.com/quochuydev/dokploy-grafana-compose) as a Compose project in Dokploy
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318` in the app container

## Configuration

### Development (.env.local)

| Variable                   | Required     | Description                            |
| -------------------------- | ------------ | -------------------------------------- |
| `BACKEND_MODE`             | Yes          | `local`, `datalab`, or `modal`         |
| `SITE_URL`                 | Yes          | Frontend URL (default: localhost:5173) |
| `DATALAB_API_KEY`          | datalab      | From [datalab.to](https://datalab.to)  |
| `MODAL_MARKER_URL`         | modal        | Modal marker endpoint URL              |
| `MODAL_LIGHTONOCR_URL`     | modal        | Modal lightonocr endpoint URL          |
| `MODAL_CHANDRA_URL`        | modal        | Modal chandra endpoint URL             |
| `MODAL_KOKORO_TTS_URL`     | modal        | Modal kokoro TTS endpoint URL          |
| `MODAL_QWEN3_TTS_URL`      | modal        | Modal qwen3 TTS endpoint URL           |
| `GOOGLE_API_KEY`           | local/modal  | For Gemini API                         |

### Production (set in Dokploy UI)

**App Container:**

| Variable                      | Required | Description                             |
| ----------------------------- | -------- | --------------------------------------- |
| `BACKEND_MODE`                | Yes      | `datalab` or `modal`                    |
| `SITE_URL`                    | Yes      | <https://yourdomain.com>                |
| `DATALAB_API_KEY`             | datalab  | Production API key                      |
| `MODAL_*_URL`                 | modal    | Modal endpoint URLs (see above)         |
| `S3_*`                        | modal    | S3/R2 credentials                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | `http://alloy:4318` for Grafana logging |

**Convex Container:**

| Variable              | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `CONVEX_CLOUD_ORIGIN` | Yes      | <https://convex-api.yourdomain.com>          |
| `CONVEX_SITE_ORIGIN`  | Yes      | <https://convex-http-actions.yourdomain.com> |
| `DISABLE_BEACON`      | No       | Set to `true` to disable telemetry           |

**GitHub Secrets:**

| Secret                 | Description                |
| ---------------------- | -------------------------- |
| `DOCKERHUB_USERNAME`   | Docker Hub username        |
| `DOCKERHUB_TOKEN`      | Docker Hub access token    |
| `CONVEX_ADMIN_KEY`     | From generate_admin_key.sh |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `BETTER_AUTH_SECRET`   | Auth encryption secret     |
| `MODAL_TOKEN_ID`       | Modal authentication       |
| `MODAL_TOKEN_SECRET`   | Modal authentication       |

See `.env.local.example` and `.env.production.example` for all options.
