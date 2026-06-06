"""Voice configuration for Kokoro TTS."""

from dataclasses import dataclass

from tts_manifest import voices_for_engine


@dataclass
class VoiceConfig:
    id: str
    display_name: str
    kokoro_voice: str


VOICES: dict[str, VoiceConfig] = {
    voice["id"]: VoiceConfig(
        id=voice["id"],
        display_name=voice["displayName"],
        kokoro_voice=voice["kokoro"]["voice"],
    )
    for voice in voices_for_engine("kokoro")
}
