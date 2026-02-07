"""Voice configuration for Kokoro TTS."""

from dataclasses import dataclass


@dataclass
class VoiceConfig:
    id: str
    display_name: str
    kokoro_voice: str


VOICES: dict[str, VoiceConfig] = {
    "female_1": VoiceConfig(
        id="female_1",
        display_name="Female 1",
        kokoro_voice="af_heart",
    ),
    "female_2": VoiceConfig(
        id="female_2",
        display_name="Female 2",
        kokoro_voice="af_bella",
    ),
}


def list_voices() -> list[dict]:
    return [{"id": v.id, "displayName": v.display_name} for v in VOICES.values()]
