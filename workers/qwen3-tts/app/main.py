"""FastAPI application for Qwen3-TTS synthesis using nano_qwen3tts."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.voices import VOICES, list_voices
from .synthesis import synthesize, synthesize_streaming

app = FastAPI(title="Qwen3-TTS Worker", version="2.0.0")


class SynthesizeRequest(BaseModel):
    """Request body for synthesis endpoint."""

    text: str
    voiceId: str = "male_1"


class StreamRequest(BaseModel):
    """Request body for streaming synthesis."""

    text: str
    voice_id: str = "male_1"


class SynthesizeResponse(BaseModel):
    """Response body for synthesis endpoint."""

    audio: str
    sampleRate: int
    durationMs: float


class VoiceInfo(BaseModel):
    """Voice information."""

    id: str
    displayName: str


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/voices", response_model=list[VoiceInfo])
async def get_voices():
    """List available voices."""
    return list_voices()


@app.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize_endpoint(request: SynthesizeRequest):
    """Synthesize speech from text."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.voiceId not in VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voiceId}. Available: {list(VOICES.keys())}",
        )

    try:
        audio_base64, sample_rate, duration_ms = synthesize(
            request.text, request.voiceId
        )
        return SynthesizeResponse(
            audio=audio_base64,
            sampleRate=sample_rate,
            durationMs=duration_ms,
        )
    except Exception as e:
        print(f"[error] Synthesis failed: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/synthesize/stream")
async def synthesize_stream(request: StreamRequest):
    """Stream audio as it's generated.

    Returns raw PCM s16le audio at 24kHz mono.
    Client plays with: ffplay -f s16le -ar 24000 -ac 1 -
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if request.voice_id not in VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice: {request.voice_id}. Available: {list(VOICES.keys())}",
        )

    def audio_generator():
        for chunk in synthesize_streaming(request.text, request.voice_id):
            yield chunk

    return StreamingResponse(
        audio_generator(),
        media_type="audio/pcm",
        headers={
            "Transfer-Encoding": "chunked",
            "X-Audio-Sample-Rate": "24000",
            "X-Audio-Channels": "1",
            "X-Audio-Format": "s16le",
        },
    )


@app.post("/load")
async def load():
    """Load TTS model. Idempotent - instant if already loaded."""
    from .models import get_or_create_model, _model_cache

    if _model_cache is not None:
        return {"status": "already_loaded"}
    get_or_create_model()
    return {"status": "ok"}


@app.post("/unload")
async def unload():
    """Unload TTS model to free GPU memory."""
    from .models import unload_model

    unloaded = unload_model()
    return {"unloaded": unloaded}
