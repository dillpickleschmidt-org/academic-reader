import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from queue import Empty

import httpx
from fastapi import FastAPI, HTTPException
from sse_starlette.sse import EventSourceResponse

from .config import UPLOAD_DIR
from .process_manager import get_process_manager


class PollFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "/jobs/" not in record.getMessage()


logging.getLogger("uvicorn.access").addFilter(PollFilter())

app = FastAPI()

UPLOAD_DIR.mkdir(exist_ok=True)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/load")
async def load():
    """No-op. Subprocess loads its own models (spawn can't share GPU memory)."""
    return {"status": "ok"}


@app.post("/unload")
async def unload():
    """No-op. Models only exist in subprocess."""
    return {"unloaded": False}


@app.post("/convert/{file_id}")
async def convert(
    file_id: str,
    output_format: str = "html",
    use_llm: bool = False,
    force_ocr: bool = False,
    page_range: str | None = None,
    file_url: str | None = None,
):
    if file_url:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
                response = await client.get(file_url)
                response.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=400, detail=f"Failed to download file: {str(e)}")

        # Determine extension from URL path (before query params)
        url_path = file_url.split("?")[0]
        ext = Path(url_path).suffix.lower() or ".pdf"
        file_path = UPLOAD_DIR / f"{file_id}{ext}"
        file_path.write_bytes(response.content)
    else:
        matching_files = list(UPLOAD_DIR.glob(f"{file_id}.*"))
        if not matching_files:
            raise HTTPException(status_code=404, detail="File not found. Upload first or provide file_url.")
        file_path = matching_files[0]

    job_id = str(uuid.uuid4())

    manager = get_process_manager()
    manager.create_job(job_id, file_id, output_format)
    manager.start_job(
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
    manager = get_process_manager()
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
    }

    if job["status"] == "completed":
        response["result"] = job["result"]
        manager.cleanup_finished(job_id)
    elif job["status"] == "failed":
        response["error"] = job.get("error", "Unknown error")
        manager.cleanup_finished(job_id)
    elif job["status"] == "cancelled":
        response["error"] = "Job was cancelled"

    return response


@app.get("/jobs/{job_id}/stream")
async def stream_job_status(job_id: str):
    """Stream job status updates via Server-Sent Events."""
    manager = get_process_manager()
    html_ready_sent = False
    queue = manager.get_queue(job_id)

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
            job = manager.get_job(job_id)

            if not job:
                yield {"event": "error", "data": "Job not found"}
                return

            if job["status"] == "completed":
                if not html_ready_sent and "html_content" in job:
                    yield {
                        "event": "html_ready",
                        "data": json.dumps({"content": job["html_content"]}),
                    }
                    html_ready_sent = True
                yield {"event": "completed", "data": json.dumps(job["result"])}
                manager.cleanup_finished(job_id)
                return
            elif job["status"] == "failed":
                yield {"event": "failed", "data": job.get("error", "Unknown error")}
                manager.cleanup_finished(job_id)
                return
            elif job["status"] == "cancelled":
                yield {"event": "cancelled", "data": "Job was cancelled"}
                manager.cleanup_finished(job_id)
                return
            elif job["status"] == "html_ready" and not html_ready_sent:
                yield {
                    "event": "html_ready",
                    "data": json.dumps({"content": job["html_content"]}),
                }
                html_ready_sent = True

    return EventSourceResponse(event_generator())


@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a running conversion job."""
    manager = get_process_manager()

    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] in ("completed", "failed", "cancelled"):
        return {"status": job["status"], "message": "Job already finished"}

    success = await asyncio.to_thread(manager.cancel_job, job_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to cancel job")

    return {"status": "cancelled", "job_id": job_id}
