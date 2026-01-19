"""Runpod Serverless handler for TTS."""

import runpod

from .synthesis import synthesize
from .voices import list_voices, VOICES


def handler(job: dict) -> dict:
    """
    Handler for Runpod Serverless TTS.

    Input:
        operation: "synthesize" | "listVoices"

        For synthesize:
            text: str - Text to synthesize
            voiceId: str - Voice ID (default: "male_1")

    Returns:
        For synthesize:
            audio: str - Base64 encoded WAV
            sampleRate: int
            durationMs: float

        For listVoices:
            voices: list[{id: str, displayName: str}]
    """
    job_input = job["input"]
    operation = job_input.get("operation", "synthesize")

    if operation == "listVoices":
        return {"voices": list_voices()}

    if operation == "synthesize":
        text = job_input.get("text")
        if not text or not text.strip():
            return {"error": "Missing or empty required field: text"}

        voice_id = job_input.get("voiceId", "male_1")
        if voice_id not in VOICES:
            return {
                "error": f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}"
            }

        try:
            audio_base64, sample_rate, duration_ms = synthesize(text, voice_id)
            return {
                "audio": audio_base64,
                "sampleRate": sample_rate,
                "durationMs": duration_ms,
            }
        except Exception as e:
            return {"error": f"Synthesis failed: {e}"}

    return {"error": f"Unknown operation: {operation}"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
