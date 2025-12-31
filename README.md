# Academic Reader

Document to HTML/Markdown converter using [Marker](https://github.com/datalab-to/marker).

Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

## Quick Start

```bash
# 1. Configure
cp .env.example .env.local
# Edit .env.local - set BACKEND_MODE and required API keys

# 2. Run
bun run dev
```

## Backend Modes

| Mode | Requirements | Best For |
|------|--------------|----------|
| `local` | Docker + NVIDIA GPU | Development, full control |
| `runpod` | Runpod API key | Cloud GPU, serverless |
| `datalab` | Datalab API key | Easiest setup, no GPU needed |

Set `BACKEND_MODE` in `.env.local` to choose.

## Development Commands

```bash
bun run dev              # Start with mode from .env.local
bun run dev:local        # Force local GPU mode
bun run dev:datalab      # Force Datalab API mode
bun run config:status    # Show current configuration
```

## Deployment

```bash
# Set BACKEND_MODE to runpod or datalab in .env.local
bun run deploy
```

## Configuration Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_MODE` | Yes | `local`, `runpod`, or `datalab` |
| `GOOGLE_API_KEY` | No | Gemini API for LLM features |
| `DATALAB_API_KEY` | datalab mode | Get from [datalab.to](https://datalab.to) |
| `RUNPOD_API_KEY` | runpod mode | Get from Runpod dashboard |
| `RUNPOD_ENDPOINT_ID` | runpod mode | Your Runpod endpoint ID |

See `.env.example` for all options.

## API

### Upload a file
```bash
curl -X POST http://localhost:8000/upload -F "file=@paper.pdf"
# Returns: { "file_id": "...", "filename": "...", "size": ... }
```

### Fetch from URL
```bash
curl -X POST "http://localhost:8000/fetch-url?url=https://example.com/paper.pdf"
```

### Convert
```bash
curl -X POST "http://localhost:8000/convert/{file_id}?output_format=markdown"
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `output_format` | `html` | `html`, `markdown`, or `json` |
| `use_llm` | `false` | Enable LLM for complex tables/equations |
| `force_ocr` | `false` | Force OCR for scanned documents |
| `page_range` | all | e.g., `1-5,10,15-20` |
