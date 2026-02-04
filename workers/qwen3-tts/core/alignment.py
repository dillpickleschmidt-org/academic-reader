"""MMS forced alignment for precise word-level timestamps."""

import torch
import torchaudio
from torchaudio.pipelines import MMS_FA as bundle


def load_mms_model(device: str = "cuda") -> dict:
    """Load MMS alignment model onto device."""
    model = bundle.get_model()
    model.to(device)
    model.eval()
    return {
        "model": model,
        "tokenizer": bundle.get_tokenizer(),
        "aligner": bundle.get_aligner(),
        "sample_rate": bundle.sample_rate,
        "device": device,
    }


def normalize_text(text: str) -> list[str]:
    """Normalize text for MMS alignment (lowercase, a-z and apostrophe only)."""
    normalized = text.lower()
    normalized = "".join(c if c.isalpha() or c in "' " else " " for c in normalized)
    return normalized.split()


def get_word_timestamps(
    mms_model: dict, audio: torch.Tensor, text: str, source_sr: int
) -> list[dict]:
    """Align words to audio frames using MMS CTC alignment.

    Args:
        mms_model: dict from load_mms_model()
        audio: Audio tensor (1D float)
        text: Text to align against audio
        source_sr: Source sample rate (e.g., 24000)

    Returns:
        List of {"word": str, "startMs": float, "endMs": float}
    """
    device = mms_model["device"]

    if source_sr != mms_model["sample_rate"]:
        audio = torchaudio.functional.resample(audio, source_sr, mms_model["sample_rate"])

    if audio.dim() == 1:
        audio = audio.unsqueeze(0)

    waveform = audio.to(device)

    with torch.inference_mode(), torch.autocast(device, dtype=torch.float16):
        emission, _ = mms_model["model"](waveform)

    words = normalize_text(text)

    if not words:
        return []

    emission = emission.float()
    tokens = mms_model["tokenizer"](words)
    token_spans = mms_model["aligner"](emission[0], tokens)

    num_frames = emission.shape[1]
    ratio = waveform.shape[1] / num_frames / mms_model["sample_rate"]

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
