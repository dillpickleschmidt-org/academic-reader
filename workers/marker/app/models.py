import builtins
import json
import threading
import time
from datetime import datetime, timezone

_model_cache: dict | None = None
_model_lock = threading.Lock()


def print(*values, flush=False, **kwargs):
    builtins.print(
        json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "academic-reader-worker",
            "worker": "marker",
            "eventName": "worker_lifecycle",
            "message": " ".join(str(value) for value in values),
        }),
        flush=flush,
    )


def get_or_create_models() -> dict:
    """Get cached models or create them.

    Thread-safe model initialization. Models are loaded once and cached
    for reuse across all conversions.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Loading marker models (this may take a moment)...", flush=True)
            start = time.time()
            from marker.models import create_model_dict

            _model_cache = create_model_dict()
            print(f"[models] Models loaded in {time.time() - start:.1f}s", flush=True)
        else:
            print("[models] Using cached models", flush=True)
        return _model_cache


def is_loaded() -> bool:
    """Check if models are currently loaded."""
    return _model_cache is not None


def unload_models() -> bool:
    """Unload models and free GPU memory.

    Thread-safe and idempotent. Returns True if models were unloaded,
    False if already unloaded.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Already unloaded", flush=True)
            return False

        print("[models] Unloading marker models...", flush=True)
        del _model_cache
        _model_cache = None

        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print("[models] Models unloaded, VRAM freed", flush=True)
        return True
