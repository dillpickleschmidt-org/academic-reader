"""FastAPI server for LightOnOCR (local mode) with job-based API and SSE streaming."""
import asyncio
import json
import tempfile
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from .conversion import convert_image
from .utils import get_suffix


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    HTML_READY = "html_ready"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    job_id: str
    status: JobStatus = JobStatus.PENDING
    result: dict[str, Any] | None = None
    error: str | None = None
    file_url: str = ""
    mime_type: str | None = None
    page_range: str | None = None
    # Progress info
    progress: dict[str, Any] | None = None
    html_content: str | None = None
    # Event queue for SSE streaming
    events: asyncio.Queue = field(default_factory=asyncio.Queue)


# In-memory job store
jobs: dict[str, Job] = {}

app = FastAPI(title="LightOnOCR Worker")


@app.on_event("startup")
async def startup():
    """Startup hook - vLLM is now started lazily on first request."""
    print("[lightonocr] FastAPI server starting (vLLM will start on-demand)", flush=True)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}


async def emit_event(job: Job, event: str, data: dict[str, Any]):
    """Emit an SSE event to the job's queue."""
    await job.events.put({"event": event, "data": json.dumps(data)})


async def process_job(job: Job):
    """Process a conversion job in the background, emitting SSE events."""
    job.status = JobStatus.PROCESSING
    await emit_event(job, "progress", {"stage": "Starting", "current": 0, "total": 1})

    suffix = get_suffix(job.mime_type, job.file_url)

    # Download file to temp location
    temp_path: Path | None = None
    try:
        await emit_event(job, "progress", {"stage": "Downloading file", "current": 0, "total": 1})

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
                response = await client.get(job.file_url)
                response.raise_for_status()
                f.write(response.content)
            temp_path = Path(f.name)

        # Process based on file type
        if suffix == ".pdf":
            # Use streaming conversion for PDFs
            await process_pdf_with_streaming(job, temp_path)
        elif suffix in IMAGE_EXTENSIONS:
            # Single image - run in thread pool
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, convert_image, temp_path
            )
            job.result = result
            job.html_content = result.get("formats", {}).get("html")
            job.status = JobStatus.COMPLETED
            await emit_event(job, "completed", result)
        else:
            raise ValueError(f"Unsupported file type: {suffix}")

    except httpx.HTTPError as e:
        job.error = f"Failed to download file: {e}"
        job.status = JobStatus.FAILED
        await emit_event(job, "failed", {"error": job.error})
    except ValueError as e:
        job.error = str(e)
        job.status = JobStatus.FAILED
        await emit_event(job, "failed", {"error": job.error})
    except Exception as e:
        import traceback
        traceback.print_exc()
        job.error = f"Conversion failed: {e}"
        job.status = JobStatus.FAILED
        await emit_event(job, "failed", {"error": job.error})
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


async def process_pdf_with_streaming(job: Job, pdf_path: Path):
    """Process a PDF file with per-page progress events."""
    loop = asyncio.get_event_loop()

    # Get total pages and parse page range
    from .markdown_utils import get_pdf_page_count, parse_page_range
    total_pages = get_pdf_page_count(pdf_path)
    pages = parse_page_range(job.page_range, total_pages)

    markdown_parts: list[str] = []
    all_images: dict[str, str] = {}
    image_counter = 0

    for idx, page_idx in enumerate(pages):
        # Emit progress for each page
        job.progress = {
            "stage": "OCR inference",
            "current": idx + 1,
            "total": len(pages),
        }
        await emit_event(job, "progress", job.progress)

        # Process single page in thread pool
        page_result = await loop.run_in_executor(
            None, convert_pdf_page, pdf_path, page_idx, image_counter
        )

        markdown_parts.append(page_result["markdown"])
        all_images.update(page_result["images"])
        image_counter = page_result["next_image_counter"]

    # Combine all pages
    from .markdown_utils import markdown_to_html
    markdown_content = "\n\n---\n\n".join(markdown_parts)
    html_content = markdown_to_html(markdown_content)

    # Emit html_ready event
    job.html_content = html_content
    job.status = JobStatus.HTML_READY
    await emit_event(job, "html_ready", {"content": html_content})

    # Build final result
    job.result = {
        "content": html_content,
        "metadata": {"page_count": len(pages), "processor": "lightonocr"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "json": None,
            "chunks": None,
        },
        "images": all_images if all_images else None,
    }
    job.status = JobStatus.COMPLETED
    await emit_event(job, "completed", job.result)


def convert_pdf_page(pdf_path: Path, page_idx: int, image_counter: int) -> dict:
    """Convert a single PDF page (runs in thread pool)."""
    from .markdown_utils import (
        render_pdf_page,
        resize_image_for_inference,
        pil_to_base64,
        parse_bbox_from_markdown,
        extract_images_from_pdf,
    )
    from .vllm_client import run_inference

    # Render page to image
    page_image = render_pdf_page(pdf_path, page_idx)
    page_image = resize_image_for_inference(page_image)

    # Run OCR inference
    image_b64 = pil_to_base64(page_image)
    raw_markdown = run_inference(image_b64)

    # Parse bbox annotations and extract images
    cleaned_md, bboxes = parse_bbox_from_markdown(raw_markdown)

    all_images: dict[str, str] = {}

    # Renumber images to be globally unique across pages
    if bboxes:
        renumbered_bboxes: dict[str, list[int]] = {}
        md_with_renumbered = cleaned_md

        for old_name, coords in bboxes.items():
            image_counter += 1
            new_name = f"image_{image_counter}.png"
            renumbered_bboxes[new_name] = coords
            md_with_renumbered = md_with_renumbered.replace(
                f"![image]({old_name})",
                f"![image]({new_name})"
            )

        cleaned_md = md_with_renumbered

        # Extract actual images from PDF
        extracted = extract_images_from_pdf(pdf_path, page_idx, renumbered_bboxes)
        all_images.update(extracted)

    return {
        "markdown": cleaned_md,
        "images": all_images,
        "next_image_counter": image_counter,
    }


@app.post("/convert")
async def convert(
    file_url: str = Query(..., description="URL to download the file from"),
    mime_type: str | None = Query(None, description="MIME type of the file"),
    page_range: str | None = Query(None, description="Page range like '1-5' or '1,3,5'"),
):
    """
    Start a conversion job for a PDF or image file.

    Returns a job_id that can be used to poll for status.
    """
    if not file_url:
        raise HTTPException(status_code=400, detail="file_url is required")

    # Create job
    job_id = str(uuid.uuid4())
    job = Job(job_id=job_id, file_url=file_url, mime_type=mime_type, page_range=page_range)
    jobs[job_id] = job

    # Start processing in background
    asyncio.create_task(process_job(job))

    return JSONResponse(content={"job_id": job_id})


@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a conversion job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response: dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status.value,
    }

    # Include progress if available
    if job.progress:
        response["progress"] = job.progress

    # Include html_content for html_ready state
    if job.html_content:
        response["html_content"] = job.html_content

    if job.status == JobStatus.COMPLETED and job.result:
        response["result"] = job.result

    if job.error:
        response["error"] = job.error

    return JSONResponse(content=response)


@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    """SSE stream for job progress and completion."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[dict, None]:
        """Generate SSE events from job's event queue."""
        while True:
            try:
                # Wait for event from job processing with timeout for keepalive
                event = await asyncio.wait_for(job.events.get(), timeout=30)
                yield event

                # Stop after terminal events
                if event["event"] in ("completed", "failed"):
                    break
            except asyncio.TimeoutError:
                # Send keepalive ping
                yield {"event": "ping", "data": "{}"}

                # Also check if job completed without us seeing the event
                if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                    break

    return EventSourceResponse(event_generator())


@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a job (best effort - may not stop in-progress work)."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in (JobStatus.PENDING, JobStatus.PROCESSING):
        job.status = JobStatus.FAILED
        job.error = "Cancelled by user"

    return JSONResponse(content={"cancelled": True})


@app.post("/load")
async def load():
    """Start vLLM server. Blocks until ready (~25 seconds). Idempotent."""
    from .vllm_manager import is_vllm_running, start_vllm

    if is_vllm_running():
        return {"status": "already_loaded"}
    start_vllm()
    return {"status": "ok"}


@app.post("/unload")
async def unload():
    """Stop vLLM server to free GPU memory. Idempotent."""
    from .vllm_manager import stop_vllm

    unloaded = stop_vllm()
    return {"unloaded": unloaded}
