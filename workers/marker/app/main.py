import asyncio
import logging
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException

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


@app.post("/convert/{file_id}")
async def convert(
    file_id: str,
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
    manager.create_job(job_id)
    manager.start_job(
        job_id,
        file_path,
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
