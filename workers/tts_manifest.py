import json
import os
from pathlib import Path
from typing import Any


def load_tts_manifest() -> dict[str, Any]:
    for path in candidate_paths():
        if path.is_file():
            return json.loads(path.read_text())
    searched = ", ".join(str(path) for path in candidate_paths())
    raise FileNotFoundError(f"TTS manifest not found. Searched: {searched}")


def voices_for_engine(engine: str) -> list[dict[str, Any]]:
    return [voice for voice in MANIFEST["voices"] if voice["engine"] == engine]


def default_voice_id_for_engine(engine: str) -> str:
    default_voice_id = MANIFEST["defaultVoiceId"]
    for voice in voices_for_engine(engine):
        if voice["id"] == default_voice_id:
            return default_voice_id

    voices = voices_for_engine(engine)
    if not voices:
        raise ValueError(f"No voices configured for TTS engine: {engine}")
    return voices[0]["id"]


def candidate_paths() -> list[Path]:
    env_path = os.environ.get("TTS_MANIFEST_PATH")
    helper_path = Path(__file__).resolve()
    paths = [
        Path("/app/tts-manifest.json"),
        Path("/root/tts-manifest.json"),
        helper_path.parent / "tts-manifest.json",
        helper_path.parents[1] / "packages/api-client/src/tts-manifest.json",
    ]
    if env_path:
        paths.insert(0, Path(env_path))
    return paths


MANIFEST = load_tts_manifest()
SAMPLE_RATE = int(MANIFEST["sampleRate"])
DEFAULT_VOICE_ID = str(MANIFEST["defaultVoiceId"])
