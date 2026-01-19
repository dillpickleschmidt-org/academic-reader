"""Audio synthesis and post-processing."""

import base64
import io
import time

import numpy as np
from scipy.io import wavfile

from .models import get_or_create_model
from .voices import get_voice


def compress(
    audio: np.ndarray,
    sr: int,
    threshold_db: float = -20,
    ratio: float = 4,
    attack_ms: float = 5,
    release_ms: float = 50,
) -> np.ndarray:
    """Apply dynamic range compression to audio."""
    eps = 1e-10
    audio_db = 20 * np.log10(np.abs(audio) + eps)
    over_threshold = np.maximum(audio_db - threshold_db, 0)
    gain_reduction_db = over_threshold * (1 - 1 / ratio)

    attack_coef = np.exp(-1 / (attack_ms / 1000 * sr)) if attack_ms > 0 else 0
    release_coef = np.exp(-1 / (release_ms / 1000 * sr)) if release_ms > 0 else 0

    smoothed_gr = np.zeros_like(gain_reduction_db)
    current = 0.0
    for i in range(len(gain_reduction_db)):
        target = gain_reduction_db[i]
        coef = attack_coef if target > current else release_coef
        current = coef * current + (1 - coef) * target
        smoothed_gr[i] = current

    compressed = audio * 10 ** (-smoothed_gr / 20)
    return compressed / np.max(np.abs(compressed)) * 0.99


def synthesize(text: str, voice_id: str) -> tuple[str, int, float]:
    """Synthesize speech from text.

    Args:
        text: Text to synthesize
        voice_id: Voice configuration ID

    Returns:
        Tuple of (base64_audio, sample_rate, duration_ms)
    """
    voice = get_voice(voice_id)
    model = get_or_create_model()

    print(f"[synthesis] Generating speech with voice '{voice_id}'...", flush=True)
    start = time.time()

    # Generate audio
    wav = model.generate(
        text,
        audio_prompt_path=str(voice.reference_path),
        exaggeration=voice.exaggeration,
    )
    audio = wav.squeeze(0).numpy()
    sr = model.sr

    gen_time = time.time() - start
    print(f"[synthesis] Generated in {gen_time:.1f}s", flush=True)

    # Post-process if configured
    if voice.post_process:
        print("[synthesis] Applying post-processing...", flush=True)
        audio = compress(audio, sr)

    # Calculate duration
    duration_ms = len(audio) / sr * 1000

    # Convert to WAV bytes
    audio_int16 = (audio * 32767).astype(np.int16)
    buffer = io.BytesIO()
    wavfile.write(buffer, sr, audio_int16)
    wav_bytes = buffer.getvalue()

    # Encode as base64
    audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

    return audio_base64, sr, duration_ms
