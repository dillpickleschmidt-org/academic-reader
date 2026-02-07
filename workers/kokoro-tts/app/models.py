"""Thread-safe model loading for Kokoro TTS."""

import threading
import time
from dataclasses import dataclass
from typing import Optional

import torch


@dataclass
class ModelCache:
    """Cached model instances."""

    pipeline: "KPipeline"


_model_cache: Optional[ModelCache] = None
_model_lock = threading.Lock()


def get_or_create_model() -> ModelCache:
    """Get cached models or create them.

    Thread-safe model initialization. Models are loaded once and cached
    for reuse across all synthesis requests.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Loading Kokoro TTS pipeline...", flush=True)
            start = time.time()

            from kokoro import KPipeline

            from core.voices import VOICES

            pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

            print("[models] Pre-loading voices...", flush=True)
            for voice in VOICES.values():
                pipeline.load_voice(voice.kokoro_voice)
            print(f"[models] Loaded {len(VOICES)} voice(s)", flush=True)

            _model_cache = ModelCache(pipeline=pipeline)

            print("[models] Running warmup...", flush=True)
            _warmup(_model_cache)
            print(f"[models] Ready in {time.time() - start:.1f}s", flush=True)

        return _model_cache


def _warmup(cache: ModelCache):
    """Warmup inference to compile any kernels."""
    from core.voices import VOICES

    voice = next(iter(VOICES.values()))
    for _ in cache.pipeline("Hello, this is a warmup.", voice=voice.kokoro_voice, speed=1.0):
        pass
    print("[models] Warmup complete", flush=True)


def unload_model() -> bool:
    """Unload models and free GPU memory."""
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Models already unloaded", flush=True)
            return False

        print("[models] Unloading models...", flush=True)
        del _model_cache
        _model_cache = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print("[models] Models unloaded, VRAM freed", flush=True)
        return True
