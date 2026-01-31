"""Thread-safe model loading for Qwen3-TTS."""

import threading
import time
from typing import TYPE_CHECKING

import torch

if TYPE_CHECKING:
    from qwen_tts import Qwen3TTSModel

_model_cache: "Qwen3TTSModel | None" = None
_model_lock = threading.Lock()


def get_or_create_model() -> "Qwen3TTSModel":
    """Get cached TTS model or create it.

    Thread-safe model initialization. Model is loaded once and cached
    for reuse across all synthesis requests.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Loading qwen-tts model...", flush=True)
            start = time.time()

            from qwen_tts import Qwen3TTSModel

            _model_cache = Qwen3TTSModel.from_pretrained(
                "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
                device_map="cuda:0",
            )
            print(f"[models] Model loaded in {time.time() - start:.1f}s", flush=True)
        else:
            print("[models] Using cached model", flush=True)
        return _model_cache


def is_model_loaded() -> bool:
    """Check if model is currently loaded."""
    return _model_cache is not None


def unload_model() -> bool:
    """Unload TTS model and free GPU memory.

    Thread-safe and idempotent. Returns True if model was unloaded,
    False if already unloaded.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Model already unloaded", flush=True)
            return False

        print("[models] Unloading qwen-tts model...", flush=True)
        del _model_cache
        _model_cache = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print("[models] Model unloaded, VRAM freed", flush=True)
        return True
