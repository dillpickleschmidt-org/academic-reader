"""Shared synthesis logic for Qwen3-TTS.

Both Docker (app/main.py) and Modal (modal_app.py) call these functions,
passing any object with .interface, .speech_tokenizer, and .voice_prompts.
"""

import base64
import json
import threading
from typing import Generator

import numpy as np
import torch

from core.alignment import get_word_timestamps
from core.transcription import transcribe
from core.voices import VOICES


def synthesize_streaming(text: str, voice_id: str, model, chunk_size: int = 50) -> Generator[dict, None, None]:
    """Synthesize speech with streaming output and periodic alignment.

    Args:
        model: Any object with .interface, .speech_tokenizer, .voice_prompts

    Yields:
        {"type": "audio", "data": <pcm bytes>} or
        {"type": "timestamps", "wordTimestamps": [...]}
    """
    voice = VOICES[voice_id]
    voice_prompt = model.voice_prompts[voice_id]

    accumulated_codes = []
    yielded_audio_samples = 0
    timestamp_thread = None
    timestamp_result = [None]

    def _transcribe_and_align(audio_copy, sr):
        transcript = transcribe(model.whisper_model, audio_copy, sr)
        audio_tensor = torch.from_numpy(audio_copy).float()
        timestamp_result[0] = get_word_timestamps(model.mms_model, audio_tensor, transcript, sr)

    for codebook_ids in model.interface.generate_voice_clone(
        text=text,
        voice_clone_prompt=voice_prompt,
        language="english",
        temperature=voice.temperature,
        top_p=voice.top_p,
    ):
        accumulated_codes.append(codebook_ids)

        if timestamp_thread is not None and not timestamp_thread.is_alive():
            timestamp_thread.join()
            if timestamp_result[0] is not None:
                yield {"type": "timestamps", "wordTimestamps": timestamp_result[0]}
                timestamp_result[0] = None
            timestamp_thread = None

        if len(accumulated_codes) >= chunk_size and len(accumulated_codes) % chunk_size == 0:
            if timestamp_thread is not None:
                timestamp_thread.join()
                if timestamp_result[0] is not None:
                    yield {"type": "timestamps", "wordTimestamps": timestamp_result[0]}
                    timestamp_result[0] = None
                timestamp_thread = None

            codes_tensor = torch.tensor(accumulated_codes, device="cuda")
            codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
            wavs, sr = model.speech_tokenizer.decode_codec_ids(codes_tensor)

            full_audio = wavs[0]
            if len(full_audio) > yielded_audio_samples:
                audio_chunk = full_audio[yielded_audio_samples:]
                audio_int16 = (audio_chunk * 32767).astype(np.int16)
                yield {"type": "audio", "data": audio_int16.tobytes()}
                yielded_audio_samples = len(full_audio)

            timestamp_thread = threading.Thread(
                target=_transcribe_and_align, args=(full_audio.copy(), sr)
            )
            timestamp_thread.start()

    if timestamp_thread is not None:
        timestamp_thread.join()
        if timestamp_result[0] is not None:
            yield {"type": "timestamps", "wordTimestamps": timestamp_result[0]}
            timestamp_result[0] = None

    if accumulated_codes:
        codes_tensor = torch.tensor(accumulated_codes, device="cuda")
        codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
        wavs, sr = model.speech_tokenizer.decode_codec_ids(codes_tensor)

        full_audio = wavs[0]
        if len(full_audio) > yielded_audio_samples:
            audio_chunk = full_audio[yielded_audio_samples:]
            audio_int16 = (audio_chunk * 32767).astype(np.int16)
            yield {"type": "audio", "data": audio_int16.tobytes()}

        transcript = transcribe(model.whisper_model, full_audio, sr)
        audio_tensor = torch.from_numpy(full_audio).float()
        word_timestamps = get_word_timestamps(model.mms_model, audio_tensor, transcript, sr)
        yield {"type": "timestamps", "wordTimestamps": word_timestamps}


def synthesize_streaming_ndjson(text: str, voice_id: str, model, chunk_size: int = 50) -> Generator[str, None, None]:
    """Wrap synthesize_streaming as NDJSON lines for HTTP streaming."""
    for chunk in synthesize_streaming(text, voice_id, model, chunk_size):
        if chunk["type"] == "audio":
            yield json.dumps({
                "type": "audio",
                "data": base64.b64encode(chunk["data"]).decode("ascii"),
            }) + "\n"
        else:
            yield json.dumps(chunk) + "\n"
