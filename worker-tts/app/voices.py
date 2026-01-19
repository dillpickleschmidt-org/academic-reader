"""Voice configuration for TTS synthesis."""

from dataclasses import dataclass
from pathlib import Path

VOICES_DIR = Path(__file__).parent.parent / "voices"


@dataclass
class VoiceConfig:
    """Configuration for a TTS voice."""

    id: str
    display_name: str
    reference_audio: str  # Filename in voices/ directory
    exaggeration: float = 0.25
    cfg_weight: float = 0.5
    post_process: bool = False

    @property
    def reference_path(self) -> Path:
        return VOICES_DIR / self.reference_audio


# Voice presets
VOICES: dict[str, VoiceConfig] = {
    "male_1": VoiceConfig(
        id="male_1",
        display_name="Male 1",
        reference_audio="male_1.wav",
        exaggeration=0.25,
        post_process=False,
    ),
    "female_1": VoiceConfig(
        id="female_1",
        display_name="Female 1",
        reference_audio="female_1.wav",
        exaggeration=0.25,
        post_process=False,
    ),
}


def get_voice(voice_id: str) -> VoiceConfig:
    """Get voice configuration by ID."""
    if voice_id not in VOICES:
        raise ValueError(f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}")
    return VOICES[voice_id]


def list_voices() -> list[dict]:
    """List all available voices."""
    return [
        {"id": v.id, "displayName": v.display_name}
        for v in VOICES.values()
    ]
