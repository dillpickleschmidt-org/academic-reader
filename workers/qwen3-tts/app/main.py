"""FastAPI application for Qwen3-TTS synthesis using nano_qwen3tts."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.voices import VOICES
from core.synthesis import synthesize_streaming_ndjson
from tts_manifest import SAMPLE_RATE, default_voice_id_for_engine
from .models import get_or_create_model

app = FastAPI(title="Qwen3-TTS Worker", version="2.0.0")


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str = default_voice_id_for_engine("qwen3")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/synthesize")
async def synthesize_stream(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.voice_id not in VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voice_id}. Available: {list(VOICES.keys())}",
        )

    model = get_or_create_model()

    return StreamingResponse(
        synthesize_streaming_ndjson(request.text, request.voice_id, model),
        media_type="application/x-ndjson",
        headers={
            "Transfer-Encoding": "chunked",
            "X-Audio-Sample-Rate": str(SAMPLE_RATE),
            "X-Audio-Channels": "1",
            "X-Audio-Format": "s16le",
        },
    )


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
