"""FastAPI application for Kokoro TTS synthesis."""

import base64

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from core.voices import VOICES
from core.synthesis import synthesize
from tts_manifest import default_voice_id_for_engine
from .models import get_or_create_model

app = FastAPI(title="Kokoro-TTS Worker", version="1.0.0")


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str = default_voice_id_for_engine("kokoro")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/synthesize")
async def synthesize_route(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.voice_id not in VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voice_id}. Available: {list(VOICES.keys())}",
        )

    audio, word_timestamps = synthesize(
        request.text,
        request.voice_id,
        get_or_create_model(),
    )
    return {
        "audio": base64.b64encode(audio).decode("ascii"),
        "wordTimestamps": word_timestamps,
        "timing": {
            "source": "native",
            "status": "ok" if word_timestamps else "unavailable",
            "error": None,
            "diagnostics": None,
        },
    }


@app.post("/load")
async def load():
    from .models import _model_cache

    if _model_cache is not None:
        return {"status": "already_loaded"}
    get_or_create_model()
    return {"status": "ok"}


@app.post("/unload")
async def unload():
    from .models import unload_model

    unloaded = unload_model()
    return {"unloaded": unloaded}
