# Academic Reader

Document to HTML/Markdown converter using [Marker](https://github.com/datalab-to/marker).

Supports PDF, DOCX, XLSX, PPTX, HTML, EPUB, and images.

## Prerequisites

- Docker with [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- NVIDIA GPU (optional but recommended)
- Gemini API key (optional, for LLM-enhanced accuracy)

## Setup

```bash
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY (optional)
```

## Run

```bash
# Start the worker
docker compose up worker --build

# Or run everything (frontend + worker)
docker compose up --build
```

First build downloads ~5GB of models.

## API

### Upload a file
```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@paper.pdf"
# Returns: { "file_id": "...", "filename": "...", "size": ... }
```

### Fetch from URL
```bash
curl -X POST "http://localhost:8000/fetch-url?url=https://example.com/paper.pdf"
# Returns: { "file_id": "...", "filename": "...", "size": ... }
```

### Convert
```bash
curl -X POST "http://localhost:8000/convert/{file_id}?output_format=markdown&use_llm=false"
```

**Parameters:**
| Name | Default | Description |
|------|---------|-------------|
| `output_format` | `html` | `html`, `markdown`, or `json` |
| `use_llm` | `false` | Enable LLM for complex tables/equations |
| `force_ocr` | `false` | Force OCR for scanned documents |
| `page_range` | all | Page range (e.g., `1-5,10,15-20`) |

### Legacy (upload + convert in one request)
```bash
curl -X POST http://localhost:8000/convert \
  -F "file=@paper.pdf" \
  -F "output_format=html"
```

### Health check
```bash
curl http://localhost:8000/health
```

## Local Development

```bash
# Terminal 1: Worker
docker compose up worker --build

# Terminal 2: Frontend (hot reload)
cd frontend && bun dev
```
