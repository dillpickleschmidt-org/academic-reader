"""Progress tracking via event queue.

Events flow: tqdm patch → queue → SSE → frontend
"""

import threading
import time
from dataclasses import dataclass
from queue import Queue


@dataclass
class ProgressEvent:
    stage: str
    current: int
    total: int
    started_at: float


_queues: dict[str, Queue[ProgressEvent]] = {}
_active_job: str | None = None
_lock = threading.Lock()


def get_queue(job_id: str) -> Queue[ProgressEvent]:
    """Get or create queue for a job."""
    with _lock:
        if job_id not in _queues:
            _queues[job_id] = Queue()
        return _queues[job_id]


def clear_queue(job_id: str):
    """Remove job's queue when done."""
    with _lock:
        _queues.pop(job_id, None)


def set_active_job(job_id: str | None):
    """Set the currently active job for tqdm tracking."""
    global _active_job
    with _lock:
        _active_job = job_id


def get_active_job() -> str | None:
    """Get the currently active job ID."""
    with _lock:
        return _active_job


def install_tqdm_patch():
    """Install global tqdm patch. Must be called BEFORE any marker imports."""
    import tqdm
    import tqdm.auto
    import tqdm.std

    original_tqdm = tqdm.std.tqdm

    class TrackedTqdm(original_tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._stage = kwargs.get("desc", "Processing")
            self._tracked = False
            self._started_at = time.time()

            job_id = get_active_job()
            if job_id and self.total and self.total > 0:
                self._tracked = True
                self._job_id = job_id
                get_queue(job_id).put(
                    ProgressEvent(self._stage, 0, self.total, self._started_at)
                )

        def update(self, n=1):
            result = super().update(n)
            if self._tracked:
                get_queue(self._job_id).put(
                    ProgressEvent(self._stage, self.n, self.total, self._started_at)
                )
            return result

        def close(self):
            if self._tracked:
                get_queue(self._job_id).put(
                    ProgressEvent(self._stage, self.total, self.total, self._started_at)
                )
            super().close()

    tqdm.tqdm = TrackedTqdm
    tqdm.std.tqdm = TrackedTqdm
    tqdm.auto.tqdm = TrackedTqdm
