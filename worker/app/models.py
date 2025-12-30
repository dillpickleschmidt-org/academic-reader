import threading
import time

_model_cache: dict | None = None
_model_lock = threading.Lock()


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
