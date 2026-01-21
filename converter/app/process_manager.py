"""Process manager for job cancellation support.

Uses multiprocessing with 'spawn' for true process termination and CUDA compatibility.
"""

import multiprocessing as mp
import time
from pathlib import Path
from typing import Any, Literal

_ctx = mp.get_context("spawn")

# Status type
JobStatus = Literal["pending", "processing", "html_ready", "completed", "failed", "cancelled"]


class ProcessManager:
    """Manages conversion jobs as separate processes for cancellation support."""

    def __init__(self):
        self._manager = _ctx.Manager()
        self._jobs: dict[str, dict[str, Any]] = self._manager.dict()
        self._processes: dict[str, mp.Process] = {}
        self._queues: dict[str, mp.Queue] = {}
        self._lock = _ctx.Lock()

    def create_job(self, job_id: str, file_id: str, output_format: str) -> None:
        """Create a new job with pending status."""
        with self._lock:
            self._jobs[job_id] = {
                "status": "pending",
                "file_id": file_id,
                "output_format": output_format,
            }

    def get_job(self, job_id: str) -> dict | None:
        """Get a job by ID, or None if not found."""
        with self._lock:
            job = self._jobs.get(job_id)
            # Convert proxy dict to regular dict
            return dict(job) if job else None

    def update_job(self, job_id: str, **updates) -> None:
        """Update a job with the given fields."""
        with self._lock:
            if job_id in self._jobs:
                current = dict(self._jobs[job_id])
                current.update(updates)
                self._jobs[job_id] = current

    def get_queue(self, job_id: str) -> mp.Queue:
        """Get or create progress queue for a job."""
        with self._lock:
            if job_id not in self._queues:
                self._queues[job_id] = _ctx.Queue()
            return self._queues[job_id]

    def start_job(
        self,
        job_id: str,
        file_path: Path,
        output_format: str,
        use_llm: bool,
        page_range: str | None,
    ) -> None:
        """Start a conversion job in a separate process."""
        from .conversion_process import run_conversion_process

        queue = self.get_queue(job_id)

        process = _ctx.Process(
            target=run_conversion_process,
            args=(
                job_id,
                file_path,
                output_format,
                use_llm,
                page_range,
                self._jobs,  # Shared dict
                queue,  # Progress queue
            ),
            daemon=True,
        )
        process.start()

        with self._lock:
            self._processes[job_id] = process

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a running job by terminating its process."""
        with self._lock:
            process = self._processes.get(job_id)
            if not process:
                return False

            if not process.is_alive():
                # Process already finished
                return False

            # Try graceful termination first (SIGTERM)
            process.terminate()

            # Wait briefly for graceful shutdown
            process.join(timeout=2.0)

            # Force kill if still running (SIGKILL)
            if process.is_alive():
                process.kill()
                process.join(timeout=1.0)

            # Update job status
            if job_id in self._jobs:
                current = dict(self._jobs[job_id])
                current["status"] = "cancelled"
                self._jobs[job_id] = current

            # Cleanup
            self._cleanup_job(job_id)
            return True

    def _cleanup_job(self, job_id: str) -> None:
        """Clean up job resources (queue, process reference)."""
        # Must be called within lock
        self._processes.pop(job_id, None)
        queue = self._queues.pop(job_id, None)
        if queue:
            try:
                queue.close()
            except Exception:
                pass

    def cleanup_finished(self, job_id: str) -> None:
        """Clean up a finished job's resources."""
        with self._lock:
            process = self._processes.get(job_id)
            if process and not process.is_alive():
                self._cleanup_job(job_id)


# Singleton instance
_manager: ProcessManager | None = None


def get_process_manager() -> ProcessManager:
    """Get the singleton process manager."""
    global _manager
    if _manager is None:
        _manager = ProcessManager()
    return _manager
