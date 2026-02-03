"""Audio synthesis for Qwen3-TTS using nano_qwen3tts."""

import base64
import io
import time
from typing import Generator

import numpy as np
import torch
from scipy.io import wavfile

from core.voices import VOICES
from .models import get_or_create_model


def synthesize(text: str, voice_id: str) -> tuple[str, int, float]:
    """Synthesize speech from text.

    Args:
        text: Text to synthesize
        voice_id: Voice configuration ID

    Returns:
        Tuple of (base64_audio, sample_rate, duration_ms)
    """
    voice = VOICES[voice_id]
    cache = get_or_create_model()
    voice_prompt = cache.voice_prompts[voice_id]

    print(f"[synthesis] Generating speech with voice '{voice_id}'...", flush=True)
    start = time.time()

    audio_codes = []
    for codebook_ids in cache.interface.generate_voice_clone(
        text=text,
        voice_clone_prompt=voice_prompt,
        language="english",
        temperature=voice.temperature,
        top_p=voice.top_p,
    ):
        audio_codes.append(codebook_ids)

    gen_time = time.time() - start
    print(f"[synthesis] Generated {len(audio_codes)} codes in {gen_time:.1f}s", flush=True)

    if not audio_codes:
        raise RuntimeError("No audio codes generated")

    codes_tensor = torch.tensor(audio_codes, device="cuda")
    codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
    wavs, sr = cache.speech_tokenizer.decode_codec_ids(codes_tensor)

    audio = wavs[0]
    duration_ms = len(audio) / sr * 1000

    audio_int16 = (audio * 32767).astype(np.int16)
    buffer = io.BytesIO()
    wavfile.write(buffer, sr, audio_int16)
    wav_bytes = buffer.getvalue()

    audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

    return audio_base64, sr, duration_ms


def synthesize_streaming(text: str, voice_id: str, chunk_size: int = 50) -> Generator[bytes, None, None]:
    """Synthesize speech with streaming output.

    Args:
        text: Text to synthesize
        voice_id: Voice configuration ID
        chunk_size: Number of codes before yielding audio chunk

    Yields:
        Raw PCM audio bytes (s16le, 24kHz, mono)
    """
    voice = VOICES[voice_id]
    cache = get_or_create_model()
    voice_prompt = cache.voice_prompts[voice_id]

    accumulated_codes = []
    yielded_audio_samples = 0

    for codebook_ids in cache.interface.generate_voice_clone(
        text=text,
        voice_clone_prompt=voice_prompt,
        language="english",
        temperature=voice.temperature,
        top_p=voice.top_p,
    ):
        accumulated_codes.append(codebook_ids)

        if len(accumulated_codes) >= chunk_size and len(accumulated_codes) % chunk_size == 0:
            codes_tensor = torch.tensor(accumulated_codes, device="cuda")
            codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
            wavs, sr = cache.speech_tokenizer.decode_codec_ids(codes_tensor)

            full_audio = wavs[0]
            if len(full_audio) > yielded_audio_samples:
                audio_chunk = full_audio[yielded_audio_samples:]
                audio_int16 = (audio_chunk * 32767).astype(np.int16)
                yield audio_int16.tobytes()
                yielded_audio_samples = len(full_audio)

    if accumulated_codes:
        codes_tensor = torch.tensor(accumulated_codes, device="cuda")
        codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
        wavs, sr = cache.speech_tokenizer.decode_codec_ids(codes_tensor)

        full_audio = wavs[0]
        if len(full_audio) > yielded_audio_samples:
            audio_chunk = full_audio[yielded_audio_samples:]
            audio_int16 = (audio_chunk * 32767).astype(np.int16)
            yield audio_int16.tobytes()
