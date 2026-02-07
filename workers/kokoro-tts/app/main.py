"""FastAPI application for Kokoro TTS synthesis."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.voices import VOICES, list_voices
from core.synthesis import synthesize, synthesize_streaming_ndjson
from .models import get_or_create_model

app = FastAPI(title="Kokoro-TTS Worker", version="1.0.0")


class SynthesizeRequest(BaseModel):
    text: str
    voiceId: str = "female_1"


class StreamRequest(BaseModel):
    text: str
    voice_id: str = "female_1"


class SynthesizeResponse(BaseModel):
    audio: str
    sampleRate: int
    durationMs: float
    wordTimestamps: list[dict] = []


class VoiceInfo(BaseModel):
    id: str
    displayName: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/voices", response_model=list[VoiceInfo])
async def get_voices():
    return list_voices()


@app.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize_endpoint(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.voiceId not in VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voiceId}. Available: {list(VOICES.keys())}",
        )

    try:
        model = get_or_create_model()
        audio_base64, sample_rate, duration_ms, word_timestamps = synthesize(
            request.text, request.voiceId, model
        )
        return SynthesizeResponse(
            audio=audio_base64,
            sampleRate=sample_rate,
            durationMs=duration_ms,
            wordTimestamps=word_timestamps,
        )
    except Exception as e:
        print(f"[error] Synthesis failed: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/stream")
async def synthesize_stream(request: StreamRequest):
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
            "X-Audio-Sample-Rate": "24000",
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
