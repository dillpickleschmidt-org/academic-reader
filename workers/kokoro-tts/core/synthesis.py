"""Synthesis logic for Kokoro TTS.

Both Docker (app/main.py) and Modal (modal_app.py) call these functions,
passing any object with .pipeline attribute.
"""

import base64
import io
import json
import time
from typing import Generator

import numpy as np
import torch
from scipy.io import wavfile

from core.voices import VOICES

SAMPLE_RATE = 24000


def _extract_timestamps(result, offset_ms: float) -> list[dict]:
    """Extract word timestamps from a kokoro Result, applying offset."""
    timestamps = []
    if result.tokens:
        for token in result.tokens:
            if token.start_ts is not None and token.end_ts is not None:
                timestamps.append({
                    "word": token.text,
                    "startMs": round(token.start_ts * 1000 + offset_ms, 1),
                    "endMs": round(token.end_ts * 1000 + offset_ms, 1),
                })
    return timestamps


def synthesize(text: str, voice_id: str, model) -> tuple[str, int, float, list[dict]]:
    """Synthesize speech from text with word-level timestamps.

    Returns:
        Tuple of (base64_wav, sample_rate, duration_ms, word_timestamps)
    """
    voice = VOICES[voice_id]

    print(f"[synthesis] Generating speech with voice '{voice_id}' ({voice.kokoro_voice})...", flush=True)
    start = time.time()

    all_audio = []
    all_timestamps: list[dict] = []
    offset_ms = 0.0

    for result in model.pipeline(text, voice=voice.kokoro_voice, speed=1.0):
        if result.audio is None:
            continue

        all_audio.append(result.audio)
        all_timestamps.extend(_extract_timestamps(result, offset_ms))
        offset_ms += len(result.audio) / SAMPLE_RATE * 1000

    gen_time = time.time() - start
    print(f"[synthesis] Generated in {gen_time:.1f}s", flush=True)

    if not all_audio:
        raise RuntimeError("No audio generated")

    full_audio = torch.cat(all_audio)
    duration_ms = len(full_audio) / SAMPLE_RATE * 1000

    audio_int16 = (full_audio.cpu().numpy() * 32767).astype(np.int16)
    buffer = io.BytesIO()
    wavfile.write(buffer, SAMPLE_RATE, audio_int16)
    wav_bytes = buffer.getvalue()

    audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

    return audio_base64, SAMPLE_RATE, duration_ms, all_timestamps


def synthesize_streaming(text: str, voice_id: str, model) -> Generator[dict, None, None]:
    """Synthesize speech with streaming output.

    Yields:
        {"type": "audio", "data": <pcm bytes>} or
        {"type": "timestamps", "wordTimestamps": [...]}
    """
    voice = VOICES[voice_id]

    all_timestamps: list[dict] = []
    offset_ms = 0.0

    for result in model.pipeline(text, voice=voice.kokoro_voice, speed=1.0):
        if result.audio is None:
            continue

        audio_int16 = (result.audio.cpu().numpy() * 32767).astype(np.int16)
        yield {"type": "audio", "data": audio_int16.tobytes()}

        chunk_timestamps = _extract_timestamps(result, offset_ms)
        offset_ms += len(result.audio) / SAMPLE_RATE * 1000

        if chunk_timestamps:
            all_timestamps.extend(chunk_timestamps)
            yield {"type": "timestamps", "wordTimestamps": list(all_timestamps)}


def synthesize_streaming_ndjson(text: str, voice_id: str, model) -> Generator[str, None, None]:
    """Wrap synthesize_streaming as NDJSON lines for HTTP streaming."""
    for chunk in synthesize_streaming(text, voice_id, model):
        if chunk["type"] == "audio":
            yield json.dumps({
                "type": "audio",
                "data": base64.b64encode(chunk["data"]).decode("ascii"),
            }) + "\n"
        else:
            yield json.dumps(chunk) + "\n"
