"""Synthesis logic for Kokoro TTS."""

import numpy as np

from core.voices import VOICES
from tts_manifest import SAMPLE_RATE


def synthesize(text: str, voice_id: str, model) -> tuple[bytes, list[dict]]:
    voice = VOICES[voice_id]
    audio_chunks: list[bytes] = []
    word_timestamps: list[dict] = []
    offset_ms = 0.0

    for result in model.pipeline(text, voice=voice.kokoro_voice, speed=1.0):
        if result.audio is None:
            continue

        audio = result.audio.cpu().numpy()
        audio_chunks.append((audio * 32767).astype(np.int16).tobytes())
        word_timestamps.extend(extract_timestamps(result, offset_ms))
        offset_ms += len(audio) / SAMPLE_RATE * 1000

    return b"".join(audio_chunks), word_timestamps


def extract_timestamps(result, offset_ms: float) -> list[dict]:
    if not result.tokens:
        return []

    timestamps = []
    for token in result.tokens:
        if token.start_ts is None or token.end_ts is None:
            continue

        timestamps.append({
            "word": token.text,
            "startMs": round(token.start_ts * 1000 + offset_ms, 1),
            "endMs": round(token.end_ts * 1000 + offset_ms, 1),
        })

    return timestamps
