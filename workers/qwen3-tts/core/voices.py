"""Voice configuration for Qwen3-TTS."""

from dataclasses import dataclass


@dataclass
class VoiceConfig:
    """Configuration for a Qwen3-TTS voice."""

    id: str
    display_name: str
    prompt_file: str
    temperature: float = 0.9
    top_p: float = 1.0


VOICES: dict[str, VoiceConfig] = {
    "male_1": VoiceConfig(
        id="male_1",
        display_name="Male 1",
        prompt_file="male_1.pt",
        temperature=0.9,
        top_p=1.0,
    ),
}


def list_voices() -> list[dict]:
    """List all available voices."""
    return [{"id": v.id, "displayName": v.display_name} for v in VOICES.values()]
