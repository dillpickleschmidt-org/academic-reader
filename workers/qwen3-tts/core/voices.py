"""Voice configuration and prompt loading."""

from dataclasses import dataclass
from pathlib import Path

import torch


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


def load_voice_prompt(prompt_path: Path, device: str = "cuda") -> list:
    """Load voice prompt from .pt file and convert to VoiceClonePromptItem list."""
    from qwen_tts import VoiceClonePromptItem

    prompt_data = torch.load(prompt_path, weights_only=False)
    items = prompt_data["items"]

    def get_field(item, key, default=None):
        if isinstance(item, dict):
            return item.get(key, default)
        return getattr(item, key, default)

    def to_device(val):
        if val is None:
            return None
        if hasattr(val, "to"):
            t = val.to(device)
            if t.dtype == torch.bfloat16:
                t = t.float()
            return t
        return val

    result = []
    for item in items:
        result.append(VoiceClonePromptItem(
            ref_code=to_device(get_field(item, "ref_code")),
            ref_spk_embedding=to_device(get_field(item, "ref_spk_embedding")),
            x_vector_only_mode=get_field(item, "x_vector_only_mode", False),
            icl_mode=get_field(item, "icl_mode", True),
            ref_text=get_field(item, "ref_text"),
        ))
    return result


def list_voices() -> list[dict]:
    """List all available voices."""
    return [{"id": v.id, "displayName": v.display_name} for v in VOICES.values()]
