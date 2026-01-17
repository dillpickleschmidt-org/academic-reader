"""FastAPI application for TTS synthesis."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .synthesis import synthesize
from .voices import list_voices, VOICES

app = FastAPI(title="TTS Worker", version="1.0.0")


class SynthesizeRequest(BaseModel):
    """Request body for synthesis endpoint."""

    text: str
    voiceId: str = "male_1"


class SynthesizeResponse(BaseModel):
    """Response body for synthesis endpoint."""

    audio: str  # Base64 encoded WAV
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


@app.post("/warm")
async def warm_models():
    """Pre-load models for faster first synthesis."""
    from .models import get_or_create_model

    get_or_create_model()
    return {"status": "ok", "message": "Model loaded"}
