"""Progress tracking for tqdm → frontend.

Local (dev):    mp.Queue tqdm patch → SSE → frontend
Cloud (RunPod): webhook tqdm patch → HTTP → KV → SSE → frontend
"""

import multiprocessing as mp
import time
from dataclasses import dataclass
from typing import Callable


@dataclass
class ProgressEvent:
    stage: str
    current: int
    total: int
    started_at: float


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


def install_mp_tqdm_patch(progress_queue: mp.Queue):
    """Install tqdm patch that sends progress via multiprocessing.Queue.

    Used when running conversion in a subprocess. Must be called
    BEFORE any marker imports in the subprocess.
    """
    import tqdm
    import tqdm.auto
    import tqdm.std

    original_tqdm = tqdm.std.tqdm

    class MPQueueTqdm(original_tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._stage = kwargs.get("desc", "Processing")
            self._tracked = False
            self._started_at = time.time()

            if self.total and self.total > 0:
                self._tracked = True
                try:
                    progress_queue.put_nowait(
                        ProgressEvent(self._stage, 0, self.total, self._started_at)
                    )
                except Exception:
                    pass

        def update(self, n=1):
            result = super().update(n)
            if self._tracked:
                try:
                    progress_queue.put_nowait(
                        ProgressEvent(self._stage, self.n, self.total, self._started_at)
                    )
                except Exception:
                    pass
            return result

        def close(self):
            if self._tracked:
                try:
                    progress_queue.put_nowait(
                        ProgressEvent(self._stage, self.total, self.total, self._started_at)
                    )
                except Exception:
                    pass
            super().close()

    tqdm.tqdm = MPQueueTqdm
    tqdm.std.tqdm = MPQueueTqdm
    tqdm.auto.tqdm = MPQueueTqdm
