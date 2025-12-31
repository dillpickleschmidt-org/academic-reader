"""Progress tracking via event queue or webhook.

Local mode: tqdm patch → queue → SSE → frontend
Cloud mode: tqdm patch → HTTP webhook → KV → SSE → frontend
"""

import threading
import time
from dataclasses import dataclass
from queue import Queue
from typing import Callable


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


# Webhook-based progress tracking for cloud deployments
_webhook_callback: Callable[[str, int, int], None] | None = None


def set_webhook_callback(callback: Callable[[str, int, int], None] | None):
    """Set callback function for webhook-based progress reporting."""
    global _webhook_callback
    _webhook_callback = callback


def get_webhook_callback() -> Callable[[str, int, int], None] | None:
    """Get the current webhook callback."""
    return _webhook_callback


def install_webhook_tqdm_patch():
    """Install tqdm patch that sends progress via webhook callback."""
    import tqdm
    import tqdm.auto
    import tqdm.std

    original_tqdm = tqdm.std.tqdm

    class WebhookTqdm(original_tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._stage = kwargs.get("desc", "Processing")
            self._tracked = False
            self._last_sent = 0

            callback = get_webhook_callback()
            if callback and self.total and self.total > 0:
                self._tracked = True
                self._callback = callback
                # Send initial progress
                callback(self._stage, 0, self.total)

        def update(self, n=1):
            result = super().update(n)
            if self._tracked:
                # Throttle updates to avoid overwhelming the API (max every 500ms)
                now = time.time()
                if now - self._last_sent >= 0.5 or self.n >= self.total:
                    self._callback(self._stage, self.n, self.total)
                    self._last_sent = now
            return result

        def close(self):
            if self._tracked:
                self._callback(self._stage, self.total, self.total)
            super().close()

    tqdm.tqdm = WebhookTqdm
    tqdm.std.tqdm = WebhookTqdm
    tqdm.auto.tqdm = WebhookTqdm
