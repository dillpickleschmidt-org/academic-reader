"""Audio synthesis for Qwen3-TTS."""

import base64
import io
import time

import numpy as np
import torch
from scipy.io import wavfile

from core.streaming import generate_streaming

from .alignment import get_word_timestamps, start_loading_alignment_model
from .models import get_or_create_model
from .voices import get_voice, get_voice_prompt


def synthesize(
    text: str, voice_id: str
) -> tuple[str, int, float, list[dict[str, float | str]]]:
    """Synthesize speech from text with word-level timestamps.

    Args:
        text: Text to synthesize
        voice_id: Voice configuration ID

    Returns:
        Tuple of (base64_audio, sample_rate, duration_ms, word_timestamps)
        where word_timestamps is a list of {"word": str, "startMs": float, "endMs": float}
    """
    voice = get_voice(voice_id)
    voice_clone_prompt = get_voice_prompt(voice_id)
    model = get_or_create_model()

    start_loading_alignment_model()

    print(f"[synthesis] Generating speech with voice '{voice_id}'...", flush=True)
    start = time.time()

    audio_tensor, sr = model.generate_voice_clone(
        text=text,
        voice_clone_prompt=voice_clone_prompt,
        language="english",
        temperature=voice.temperature,
        top_p=voice.top_p,
        max_new_tokens=4096,
    )

    audio = audio_tensor.float().cpu().numpy().flatten()

    gen_time = time.time() - start
    print(f"[synthesis] Generated in {gen_time:.1f}s", flush=True)

    print("[synthesis] Computing word alignments...", flush=True)
    align_start = time.time()
    audio_for_align = torch.from_numpy(audio)
    word_timestamps = get_word_timestamps(audio_for_align, text, sr)
    align_time = time.time() - align_start
    print(
        f"[synthesis] Aligned {len(word_timestamps)} words in {align_time:.2f}s",
        flush=True,
    )

    duration_ms = len(audio) / sr * 1000

    audio_int16 = (audio * 32767).astype(np.int16)
    buffer = io.BytesIO()
    wavfile.write(buffer, sr, audio_int16)
    wav_bytes = buffer.getvalue()

    audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

    return audio_base64, sr, duration_ms, word_timestamps


def synthesize_streaming(text: str, voice_id: str):
    """Generator yielding raw PCM audio chunks as codes are generated.

    Each chunk is ~2 seconds of audio (25 codes at 12.5 Hz).
    Returns raw PCM s16le bytes at 24kHz mono.
    """
    voice = get_voice(voice_id)
    voice_clone_prompt = get_voice_prompt(voice_id)
    model = get_or_create_model()

    for audio_chunk in generate_streaming(
        model,
        text=text,
        voice_clone_prompt=voice_clone_prompt,
        language="english",
        chunk_size=25,
        temperature=voice.temperature,
        top_p=voice.top_p,
    ):
        audio_int16 = (audio_chunk * 32767).astype(np.int16)
        yield audio_int16.tobytes()
