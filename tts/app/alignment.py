"""Forced alignment for word-level timestamps using MMS."""

import threading
import time
from typing import TYPE_CHECKING

import torch
import torchaudio
from torchaudio.pipelines import MMS_FA as bundle

if TYPE_CHECKING:
    from typing import Any

_alignment_model: "dict[str, Any] | None" = None
_alignment_lock = threading.Lock()
_loading_thread: threading.Thread | None = None


def get_device() -> str:
    """Get the best available device."""
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def start_loading_alignment_model() -> None:
    """Start loading MMS alignment model in background thread.

    Call this before starting TTS generation to overlap model loading
    with audio synthesis time.
    """
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
    """Get word-level timestamps for audio.

    Args:
        audio: Audio tensor (1D or 2D with shape [C, T] or [T])
        text: Original text that was synthesized
        source_sr: Source sample rate (e.g., 24000 for Chatterbox)

    Returns:
        List of {"word": str, "startMs": float, "endMs": float}
    """
    global _loading_thread

    # Wait for background loading to complete
    if _loading_thread is not None:
        _loading_thread.join()
        _loading_thread = None

    # Load model if not already loaded
    if _alignment_model is None:
        _load_model()

    m = _alignment_model
    assert m is not None
    device = m["device"]

    # Resample to model's expected rate (24kHz -> 16kHz typically)
    if source_sr != m["sample_rate"]:
        audio = torchaudio.functional.resample(audio, source_sr, m["sample_rate"])

    # Ensure correct shape [1, T]
    if audio.dim() == 1:
        audio = audio.unsqueeze(0)

    waveform = audio.to(device)

    # Generate emissions with fp16 for memory efficiency
    with torch.inference_mode(), torch.autocast(device, dtype=torch.float16):
        emission, _ = m["model"](waveform)

    # Normalize text and split into words for tokenizer
    # MMS expects: lowercase, only a-z and apostrophe
    normalized = text.lower()
    # Keep only valid characters (letters, apostrophe, space)
    normalized = "".join(c if c.isalpha() or c in "' " else " " for c in normalized)
    words = normalized.split()

    if not words:
        return []

    # Tokenize words and align (keep alignment in fp32 for numerical stability)
    emission = emission.float()
    tokens = m["tokenizer"](words)
    token_spans = m["aligner"](emission[0], tokens)

    # Convert frame indices to milliseconds
    # ratio = seconds_per_frame
    num_frames = emission.shape[1]
    ratio = waveform.shape[1] / num_frames / m["sample_rate"]

    results: list[dict[str, float | str]] = []
    for i, span in enumerate(token_spans):
        # Handle both single TokenSpan and list of TokenSpans per word
        if isinstance(span, list):
            # If span is a list, take first and last for word boundaries
            word_start = span[0].start if span else 0
            word_end = span[-1].end if span else 0
        else:
            word_start = span.start
            word_end = span.end

        start_ms = word_start * ratio * 1000
        end_ms = word_end * ratio * 1000
        results.append({
            "word": words[i],
            "startMs": round(start_ms, 1),
            "endMs": round(end_ms, 1),
        })

    return results


def unload_alignment_model() -> bool:
    """Unload alignment model and free GPU memory.

    Returns True if model was unloaded, False if already unloaded.
    """
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
