"""Chandra model management with caching for warm Runpod workers."""
import threading
from chandra.model import InferenceManager

_manager_cache: InferenceManager | None = None
_manager_lock = threading.Lock()


def get_or_create_manager() -> InferenceManager:
    """Get cached InferenceManager or create new one."""
    global _manager_cache
    with _manager_lock:
        if _manager_cache is None:
            print("[chandra] Loading InferenceManager...")
            _manager_cache = InferenceManager(method="hf")
            print("[chandra] InferenceManager ready")
        return _manager_cache
