"""Speech transcription via faster-whisper for word detection."""

import numpy as np
from scipy.signal import resample


def transcribe(whisper_model, audio: np.ndarray, source_sr: int) -> str:
    """Transcribe audio to text.

    Args:
        whisper_model: faster_whisper.WhisperModel instance
        audio: float32 numpy array from TTS decoder
        source_sr: source sample rate (e.g., 24000)

    Returns:
        Transcribed text string
    """
    if source_sr != 16000:
        num_samples = int(len(audio) * 16000 / source_sr)
        audio = resample(audio, num_samples).astype(np.float32)

    segments, _ = whisper_model.transcribe(
        audio,
        language="en",
        beam_size=1,
        temperature=0.0,
        condition_on_previous_text=False,
        vad_filter=False,
        hallucination_silence_threshold=2.0,
        no_repeat_ngram_size=3,
    )

    return " ".join(segment.text.strip() for segment in segments)
