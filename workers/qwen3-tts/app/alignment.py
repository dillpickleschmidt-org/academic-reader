"""Word-level alignment for Qwen3-TTS (local Docker with threading)."""

import threading
import time

import torch
import torchaudio

from core.alignment import compute_word_timestamps

_alignment_model = None
_alignment_lock = threading.Lock()
_loading_thread = None


def get_device() -> str:
    """Get the best available device."""
    return "cuda" if torch.cuda.is_available() else "cpu"


def start_loading_alignment_model() -> None:
    """Start loading MMS alignment model in background thread."""
    global _loading_thread
    if _alignment_model is not None:
        return
    if _loading_thread is not None and _loading_thread.is_alive():
        return
    _loading_thread = threading.Thread(target=_load_model, daemon=True)
    _loading_thread.start()


def _load_model() -> None:
    """Load MMS alignment model (called from background thread)."""
    global _alignment_model
    with _alignment_lock:
        if _alignment_model is not None:
            return

        from torchaudio.pipelines import MMS_FA as bundle

        device = get_device()
        print(f"[alignment] Loading MMS model on {device}...", flush=True)
        start = time.time()

        model = bundle.get_model()
        model.to(device)
        model.eval()

        _alignment_model = {
            "model": model,
            "tokenizer": bundle.get_tokenizer(),
            "aligner": bundle.get_aligner(),
            "sample_rate": bundle.sample_rate,
            "device": device,
        }

        print(f"[alignment] MMS model loaded in {time.time() - start:.1f}s", flush=True)


def get_word_timestamps(
    audio: torch.Tensor, text: str, source_sr: int
) -> list[dict[str, float | str]]:
    """Get word-level timestamps for audio."""
    global _loading_thread

    if _loading_thread is not None:
        _loading_thread.join()
        _loading_thread = None

    if _alignment_model is None:
        _load_model()

    m = _alignment_model
    assert m is not None

    return compute_word_timestamps(
        audio,
        text,
        source_sr,
        m["model"],
        m["tokenizer"],
        m["aligner"],
        m["sample_rate"],
        m["device"],
    )


def unload_alignment_model() -> bool:
    """Unload alignment model and free GPU memory."""
    global _alignment_model
    with _alignment_lock:
        if _alignment_model is None:
            print("[alignment] Model already unloaded", flush=True)
            return False

        print("[alignment] Unloading MMS model...", flush=True)
        del _alignment_model
        _alignment_model = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print("[alignment] Model unloaded, VRAM freed", flush=True)
        return True
