"""Runpod Serverless handler for TTS with batch streaming."""

import runpod

from .synthesis import synthesize
from .voices import list_voices, VOICES


def handler(job: dict):
    """
    Generator handler for Runpod Serverless TTS.

    Input:
        operation: "synthesizeBatch" | "listVoices"

        For synthesizeBatch:
            segments: list[{index: int, text: str}] - Segments to synthesize
            voiceId: str - Voice ID (default: "male_1")

    Yields:
        For synthesizeBatch: {segmentIndex, audio, sampleRate, durationMs} per segment
        For listVoices: {voices: [...]}
        On error: {error: str}
    """
    job_input = job["input"]
    operation = job_input.get("operation", "synthesizeBatch")

    if operation == "listVoices":
        yield {"voices": list_voices()}
        return

    if operation == "synthesizeBatch":
        segments = job_input.get("segments", [])
        voice_id = job_input.get("voiceId", "male_1")

        if not segments:
            yield {"error": "No segments provided"}
            return

        if voice_id not in VOICES:
            yield {"error": f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}"}
            return

        for seg in segments:
            index = seg.get("index", 0)
            text = seg.get("text", "")

            if not text.strip():
                yield {"segmentIndex": index, "error": "Empty text"}
                continue

            try:
                audio_base64, sample_rate, duration_ms = synthesize(text, voice_id)
                yield {
                    "segmentIndex": index,
                    "audio": audio_base64,
                    "sampleRate": sample_rate,
                    "durationMs": duration_ms,
                }
            except Exception as e:
                yield {"segmentIndex": index, "error": str(e)}

        return

    yield {"error": f"Unknown operation: {operation}"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler, "return_aggregate_stream": True})
