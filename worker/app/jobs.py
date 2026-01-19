import threading
from typing import Literal, TypedDict


class JobResult(TypedDict):
    content: str
    metadata: dict


class Job(TypedDict, total=False):
    status: Literal["pending", "processing", "html_ready", "completed", "failed", "cancelled"]
    file_id: str
    output_format: str
    html_content: str
    result: JobResult
    error: str


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def create_job(job_id: str, file_id: str, output_format: str) -> None:
    """Create a new job with pending status."""
    with _jobs_lock:
        _jobs[job_id] = {
            "status": "pending",
            "file_id": file_id,
            "output_format": output_format,
        }


def get_job(job_id: str) -> Job | None:
    """Get a job by ID, or None if not found."""
    with _jobs_lock:
        return _jobs.get(job_id)


def update_job(job_id: str, **updates) -> None:
    """Update a job with the given fields."""
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(updates)
