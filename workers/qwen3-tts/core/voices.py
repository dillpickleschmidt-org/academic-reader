"""Voice configuration for Qwen3-TTS."""

from dataclasses import dataclass

from tts_manifest import voices_for_engine


@dataclass
class VoiceConfig:
    """Configuration for a Qwen3-TTS voice."""

    id: str
    display_name: str
    prompt_file: str
    temperature: float = 0.9
    top_p: float = 1.0


VOICES: dict[str, VoiceConfig] = {
    voice["id"]: VoiceConfig(
        id=voice["id"],
        display_name=voice["displayName"],
        prompt_file=voice["qwen3"]["promptFile"],
        temperature=voice["qwen3"].get("temperature", 0.9),
        top_p=voice["qwen3"].get("topP", 1.0),
    )
    for voice in voices_for_engine("qwen3")
}
