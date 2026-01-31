"""Voice configuration for Qwen3-TTS synthesis (local Docker wrapper)."""

from pathlib import Path

from core.voices import VOICES, load_voice_prompt

VOICES_DIR = Path(__file__).parent.parent / "voices"

_voice_prompt_cache: dict[str, list] = {}


def get_voice(voice_id: str):
    """Get voice configuration by ID."""
    if voice_id not in VOICES:
        raise ValueError(f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}")
    return VOICES[voice_id]


def get_voice_prompt(voice_id: str) -> list:
    """Get cached voice clone prompt, loading from .pt file if needed."""
    if voice_id not in _voice_prompt_cache:
        voice = get_voice(voice_id)
        prompt_path = VOICES_DIR / voice.prompt_file
        _voice_prompt_cache[voice_id] = load_voice_prompt(prompt_path, "cuda")
    return _voice_prompt_cache[voice_id]
