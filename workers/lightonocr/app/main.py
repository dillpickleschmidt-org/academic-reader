"""LightOnOCR worker with job-based API."""
import asyncio
import json
import tempfile
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from .conversion import convert_file
from .utils import get_suffix


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
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


jobs: dict[str, Job] = {}
app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


async def process_job(job: Job):
    """Process a conversion job in the background."""
    job.status = JobStatus.PROCESSING

    suffix = get_suffix(job.mime_type, job.file_url)

    # Download file to temp location
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
                response = await client.get(job.file_url)
                response.raise_for_status()
                f.write(response.content)
            temp_path = Path(f.name)

        # Convert in thread pool (handles both PDFs and images)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, convert_file, temp_path, job.page_range
        )

        job.result = result
        job.status = JobStatus.COMPLETED

    except httpx.HTTPError as e:
        job.error = f"Failed to download file: {e}"
        job.status = JobStatus.FAILED
    except ValueError as e:
        job.error = str(e)
        job.status = JobStatus.FAILED
    except Exception as e:
        import traceback
        traceback.print_exc()
        job.error = f"Conversion failed: {e}"
        job.status = JobStatus.FAILED
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


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

    if job.status == JobStatus.COMPLETED and job.result:
        response["result"] = job.result

    if job.error:
        response["error"] = job.error

    return JSONResponse(content=response)


@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    """SSE stream for job completion. Required by server-side stream proxy."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[dict, None]:
        while job.status not in (JobStatus.COMPLETED, JobStatus.FAILED):
            await asyncio.sleep(0.5)

        if job.status == JobStatus.COMPLETED and job.result:
            yield {"event": "completed", "data": json.dumps(job.result)}
        elif job.status == JobStatus.FAILED:
            yield {"event": "failed", "data": json.dumps({"error": job.error})}

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
