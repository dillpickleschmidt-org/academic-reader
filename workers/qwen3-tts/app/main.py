"""Serve Qwen3-TTS through vLLM-Omni and add word alignment."""

import asyncio
import base64
import json
import os
import subprocess
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .models import generate_word_timings

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
PORT = os.environ.get("PORT", "8002")
INTERNAL_PORT = os.environ.get("QWEN3_INTERNAL_PORT", "8003")
DEPLOY_CONFIG_PATH = os.environ.get("QWEN3_DEPLOY_CONFIG", "/app/qwen3_tts.yaml")
SAMPLE_RATE = 24_000
VLLM_URL = f"http://127.0.0.1:{INTERNAL_PORT}"
VLLM_READY_TIMEOUT_SECONDS = 290
SYNTHESIS_TIMEOUT_SECONDS = 600

_vllm_process: subprocess.Popen | None = None


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str = "male_1"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    start_vllm()
    try:
        yield
    finally:
        stop_vllm()


app = FastAPI(title="Qwen3-TTS Worker", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    if not await wait_for_vllm_ready(VLLM_READY_TIMEOUT_SECONDS):
        raise HTTPException(status_code=503, detail="vLLM-Omni is not ready")
    return {"status": "ok"}


@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if not await wait_for_vllm_ready(VLLM_READY_TIMEOUT_SECONDS):
        raise HTTPException(status_code=503, detail="vLLM-Omni is not ready")

    pcm = await synthesize_pcm(request.text, request.voice_id)
    timing = await asyncio.to_thread(
        generate_word_timings,
        pcm,
        request.text,
        SAMPLE_RATE,
    )
    return {
        "audio": base64.b64encode(pcm).decode("ascii"),
        "wordTimestamps": timing.word_timestamps,
        "timing": {
            "source": timing.source,
            "status": timing.status,
            "error": timing.error,
            "diagnostics": timing.diagnostics,
        },
    }


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(PORT))


def start_vllm() -> None:
    global _vllm_process
    if _vllm_process is not None and _vllm_process.poll() is None:
        return

    command = [
        "vllm-omni",
        "serve",
        MODEL,
        "--deploy-config",
        DEPLOY_CONFIG_PATH,
        "--host",
        "127.0.0.1",
        "--port",
        INTERNAL_PORT,
        "--trust-remote-code",
        "--omni",
    ]
    _vllm_process = subprocess.Popen(command)


def stop_vllm() -> None:
    global _vllm_process
    if _vllm_process is None:
        return

    _vllm_process.terminate()
    try:
        _vllm_process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        _vllm_process.kill()
    _vllm_process = None


async def wait_for_vllm_ready(timeout_seconds: int) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while True:
        if _vllm_process is not None and _vllm_process.poll() is not None:
            return False

        try:
            response = await asyncio.to_thread(open_health_request)
            if response == 200:
                return True
        except URLError:
            pass

        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(1)


async def synthesize_pcm(text: str, voice_id: str) -> bytes:
    try:
        return await asyncio.to_thread(synthesize_pcm_sync, text, voice_id)
    except HTTPError as error:
        error_body = error.read().decode("utf-8", "replace")
        raise HTTPException(
            status_code=502,
            detail=f"Qwen3 TTS failed: {error_body}",
        ) from error
    except URLError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Qwen3 TTS failed: {error}",
        ) from error


def open_health_request() -> int:
    with urlopen(f"{VLLM_URL}/health", timeout=5) as response:
        return response.status


def synthesize_pcm_sync(text: str, voice_id: str) -> bytes:
    body = json.dumps({
        "model": MODEL,
        "input": text,
        "voice": voice_id,
        "task_type": "Base",
        "language": "English",
        "response_format": "pcm",
        "stream": True,
        "max_new_tokens": 4096,
    }).encode("utf-8")
    request = Request(
        f"{VLLM_URL}/v1/audio/speech",
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer EMPTY",
            "Content-Type": "application/json",
        },
    )

    chunks: list[bytes] = []
    with urlopen(request, timeout=SYNTHESIS_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            error_body = response.read().decode("utf-8", "replace")
            raise HTTPException(
                status_code=502,
                detail=f"Qwen3 TTS failed: {error_body}",
            )

        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            chunks.append(chunk)

    return b"".join(chunks)


if __name__ == "__main__":
    main()
