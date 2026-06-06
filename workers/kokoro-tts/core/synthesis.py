"""Streaming synthesis logic for Kokoro TTS."""

import base64
import json
from typing import Generator

import numpy as np

from core.voices import VOICES
from tts_manifest import SAMPLE_RATE


def _extract_timestamps(result, offset_ms: float) -> list[dict]:
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


def synthesize_streaming(text: str, voice_id: str, model) -> Generator[dict, None, None]:
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
    for chunk in synthesize_streaming(text, voice_id, model):
        if chunk["type"] == "audio":
            yield json.dumps({
                "type": "audio",
                "data": base64.b64encode(chunk["data"]).decode("ascii"),
            }) + "\n"
        else:
            yield json.dumps(chunk) + "\n"
