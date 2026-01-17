"""Thread-safe model loading for TTS."""

import threading
import time
from typing import TYPE_CHECKING

import torch

if TYPE_CHECKING:
    from chatterbox.tts import ChatterboxTTS

_model_cache: "ChatterboxTTS | None" = None
_model_lock = threading.Lock()


def get_device() -> str:
    """Get the best available device."""
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_or_create_model() -> "ChatterboxTTS":
    """Get cached TTS model or create it.

    Thread-safe model initialization. Model is loaded once and cached
    for reuse across all synthesis requests.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            device = get_device()
            print(f"[models] Loading ChatterboxTTS on {device}...", flush=True)
            start = time.time()

            from chatterbox.tts import ChatterboxTTS

            _model_cache = ChatterboxTTS.from_pretrained(device)
            print(f"[models] Model loaded in {time.time() - start:.1f}s", flush=True)
        else:
            print("[models] Using cached model", flush=True)
        return _model_cache
