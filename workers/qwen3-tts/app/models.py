"""Thread-safe word timing model loading for Qwen3-TTS."""

import json
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np
import torch

from .alignment import get_word_timestamps, load_mms_model


@dataclass
class TimingModelCache:
    mms_model: dict


@dataclass
class WordTimingResult:
    word_timestamps: list[dict]
    source: str
    status: str
    error: str | None = None
    diagnostics: dict | None = None


_model_cache: Optional[TimingModelCache] = None
_model_lock = threading.Lock()
_timing_lock = threading.Lock()


def get_or_create_models() -> TimingModelCache:
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            start = time.time()
            device = "cuda" if torch.cuda.is_available() else "cpu"

            print(
                "[timing] CUDA diagnostics: "
                + json.dumps(get_cuda_diagnostics(), sort_keys=True),
                flush=True,
            )
            print("[timing] Loading MMS alignment model...", flush=True)
            mms_model = load_mms_model(device)
            print(f"[timing] MMS loaded in {time.time() - start:.1f}s", flush=True)

            _model_cache = TimingModelCache(mms_model=mms_model)

        return _model_cache


def generate_word_timings(pcm: bytes, text: str, sample_rate: int) -> WordTimingResult:
    try:
        if len(pcm) < 2:
            return WordTimingResult([], "forced_alignment", "unavailable")

        if len(pcm) % 2:
            pcm = pcm[:-1]

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if not audio.size:
            return WordTimingResult([], "forced_alignment", "unavailable")

        with _timing_lock:
            timestamps = get_word_timestamps(
                get_or_create_models().mms_model,
                torch.from_numpy(audio),
                text,
                sample_rate,
            )

        return WordTimingResult(
            timestamps,
            "forced_alignment",
            "ok" if timestamps else "unavailable",
        )
    except Exception as error:
        diagnostics = get_cuda_diagnostics()
        print(f"[timing] Failed to generate word timings: {error}", flush=True)
        print(
            "[timing] Failure diagnostics: "
            + json.dumps(diagnostics, sort_keys=True),
            flush=True,
        )
        return WordTimingResult(
            [],
            "forced_alignment",
            "failed",
            str(error),
            diagnostics,
        )
    finally:
        release_unused_cuda_memory()


def get_cuda_diagnostics() -> dict:
    diagnostics = {
        "torchCudaAvailable": torch.cuda.is_available(),
        "torchCudaVersion": torch.version.cuda,
    }
    if not torch.cuda.is_available():
        return diagnostics

    try:
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        diagnostics.update({
            "cudaMemFreeBytes": free_bytes,
            "cudaMemTotalBytes": total_bytes,
            "torchMemAllocatedBytes": torch.cuda.memory_allocated(),
            "torchMemReservedBytes": torch.cuda.memory_reserved(),
        })
    except Exception as error:
        diagnostics["cudaMemoryError"] = str(error)

    return diagnostics


def release_unused_cuda_memory() -> None:
    if not torch.cuda.is_available():
        return

    try:
        torch.cuda.synchronize()
    except Exception:
        pass
    torch.cuda.empty_cache()
