"""MMS word-level alignment."""

import torch
import torchaudio.functional as F


def compute_word_timestamps(
    audio_tensor: torch.Tensor,
    text: str,
    sr: int,
    align_model,
    align_tokenizer,
    align_aligner,
    align_sample_rate: int,
    device: str,
) -> list[dict]:
    """Compute word-level timestamps using MMS alignment."""
    # Resample to MMS sample rate (16kHz)
    if sr != align_sample_rate:
        audio_resampled = F.resample(
            audio_tensor.unsqueeze(0), sr, align_sample_rate
        ).squeeze(0)
    else:
        audio_resampled = audio_tensor

    if audio_resampled.dim() == 1:
        audio_resampled = audio_resampled.unsqueeze(0)

    waveform = audio_resampled.to(device)

    with torch.inference_mode():
        emission, _ = align_model(waveform)

    # Normalize text: MMS expects lowercase, only a-z and apostrophe
    normalized = text.lower()
    normalized = "".join(c if c.isalpha() or c in "' " else " " for c in normalized)
    words = normalized.split()

    if not words:
        return []

    tokens = align_tokenizer(words)
    token_spans = align_aligner(emission[0], tokens)

    num_frames = emission.shape[1]
    ratio = waveform.shape[1] / num_frames / align_sample_rate

    results = []
    for i, span in enumerate(token_spans):
        if isinstance(span, list):
            word_start = span[0].start if span else 0
            word_end = span[-1].end if span else 0
        else:
            word_start = span.start
            word_end = span.end

        results.append({
            "word": words[i],
            "startMs": round(word_start * ratio * 1000, 1),
            "endMs": round(word_end * ratio * 1000, 1),
        })

    return results
