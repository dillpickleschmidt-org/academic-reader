import asyncio
import json
import logging
import time
import uuid
from pathlib import Path

# Install tqdm patch BEFORE any marker imports
from .progress import get_queue, install_tqdm_patch

install_tqdm_patch()

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .config import CORS_ORIGINS, SUPPORTED_EXTENSIONS, UPLOAD_DIR
from .conversion import run_conversion
from .jobs import create_job, get_job
from .models import get_or_create_models


class PollFilter(logging.Filter):
    """Filter out noisy polling requests from access logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/jobs/" not in msg


logging.getLogger("uvicorn.access").addFilter(PollFilter())

app = FastAPI(title="Academic Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR.mkdir(exist_ok=True)


def validate_file_extension(filename: str):
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/warm-models")
async def warm_models(background_tasks: BackgroundTasks):
    """Pre-warm models in background. Called when user selects a file."""
    background_tasks.add_task(get_or_create_models)
    return {"status": "warming"}


@app.post("/upload")
async def upload_file(file: UploadFile):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    validate_file_extension(file.filename)

    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix.lower()
    file_path = UPLOAD_DIR / f"{file_id}{ext}"

    content = await file.read()
    file_path.write_bytes(content)

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(content),
    }


@app.post("/fetch-url")
async def fetch_url(url: str):
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            response = await client.get(url)
            response.raise_for_status()

        filename = url.split("/")[-1].split("?")[0]
        if not filename or "." not in filename:
            cd = response.headers.get("content-disposition", "")
            if "filename=" in cd:
                filename = cd.split("filename=")[-1].strip('"\'')
            else:
                filename = "document.pdf"

        validate_file_extension(filename)

        file_id = str(uuid.uuid4())
        ext = Path(filename).suffix.lower()
        file_path = UPLOAD_DIR / f"{file_id}{ext}"

        file_path.write_bytes(response.content)

        return {
            "file_id": file_id,
            "filename": filename,
            "size": len(response.content),
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")


@app.post("/convert/{file_id}")
async def convert(
    file_id: str,
    background_tasks: BackgroundTasks,
    output_format: str = "html",
    use_llm: bool = False,
    force_ocr: bool = False,
    page_range: str | None = None,
):
    matching_files = list(UPLOAD_DIR.glob(f"{file_id}.*"))
    if not matching_files:
        raise HTTPException(status_code=404, detail="File not found. Upload first.")

    file_path = matching_files[0]
    job_id = str(uuid.uuid4())

    create_job(job_id, file_id, output_format)

    background_tasks.add_task(
        run_conversion,
        job_id,
        file_path,
        output_format,
        use_llm,
        force_ocr,
        page_range,
    )

    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
    }

    if job["status"] == "completed":
        response["result"] = job["result"]
    elif job["status"] == "failed":
        response["error"] = job.get("error", "Unknown error")

    return response


@app.get("/jobs/{job_id}/stream")
async def stream_job_status(job_id: str):
    """Stream job status updates via Server-Sent Events."""
    from queue import Empty

    html_ready_sent = False
    queue = get_queue(job_id)

    async def event_generator():
        nonlocal html_ready_sent

        while True:
            # Wait for progress event or timeout
            try:
                event = await asyncio.to_thread(queue.get, True, 0.5)
                elapsed = round(time.time() - event.started_at, 1)
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "stage": event.stage,
                        "current": event.current,
                        "total": event.total,
                        "elapsed": elapsed,
                    }),
                }
                continue  # Check for more events immediately
            except Empty:
                pass  # Timeout - check job status

            # Check job status
            job = get_job(job_id)

            if not job:
                yield {"event": "error", "data": "Job not found"}
                return

            if job["status"] == "completed":
                yield {"event": "completed", "data": json.dumps(job["result"])}
                return
            elif job["status"] == "failed":
                yield {"event": "failed", "data": job.get("error", "Unknown error")}
                return
            elif job["status"] == "html_ready" and not html_ready_sent:
                yield {
                    "event": "html_ready",
                    "data": json.dumps({"content": job["html_content"]}),
                }
                html_ready_sent = True

    return EventSourceResponse(event_generator())
