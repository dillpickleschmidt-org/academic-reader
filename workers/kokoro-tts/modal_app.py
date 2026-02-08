"""Modal worker for Kokoro TTS."""

import modal
from pathlib import Path

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("espeak-ng")
    .pip_install(
        "torch==2.8.0",
        extra_index_url="https://download.pytorch.org/whl/cu126",
    )
    .pip_install(
        "kokoro>=0.9.4",
        "numpy",
        "scipy",
        "fastapi>=0.115.0",
        "pydantic>=2.0.0",
    )
    .run_commands(
        'python -c "'
        "from kokoro import KPipeline; "
        "p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M'); "
        "p.load_voice('af_heart'); "
        "p.load_voice('af_bella'); "
        "print('Kokoro cached')"
        '"'
    )
    .add_local_dir(Path(__file__).parent / "core", remote_path="/root/core")
)

app = modal.App("kokoro-tts", image=image)

snapshot_key = "v1"

with image.imports():
    import sys
    sys.path.insert(0, "/root")

    from core.voices import VOICES, list_voices
    from core.synthesis import synthesize as core_synthesize, synthesize_streaming_ndjson, synthesize_batch_ndjson


@app.cls(
    gpu="T4",
    cpu=2.0,
    memory=8192,
    timeout=300,
    scaledown_window=5,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class KokoroTTS:
    """Kokoro TTS worker with GPU snapshots."""

    @modal.enter(snap=True)
    def load_snap(self):
        """Full initialization in snap=True for GPU snapshot."""
        import time

        print("[kokoro-tts] Starting initialization...", flush=True)
        start = time.perf_counter()

        from kokoro import KPipeline

        self.pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

        print("[kokoro-tts] Pre-loading voices...", flush=True)
        for voice in VOICES.values():
            self.pipeline.load_voice(voice.kokoro_voice)
        print(f"[kokoro-tts] Loaded {len(VOICES)} voice(s)", flush=True)

        print("[kokoro-tts] Running warmup...", flush=True)
        voice = next(iter(VOICES.values()))
        for _ in self.pipeline("Hello, this is a warmup.", voice=voice.kokoro_voice, speed=1.0):
            pass

        print(f"[kokoro-tts] snap=True complete in {time.perf_counter() - start:.1f}s, ready for snapshot {snapshot_key}", flush=True)

    @modal.enter(snap=False)
    def post_restore(self):
        """After restore - verify everything survived."""
        print(f"[kokoro-tts] snap=False: Restored from snapshot {snapshot_key}", flush=True)
        print(f"[kokoro-tts] Pipeline: {self.pipeline is not None}", flush=True)
        print("[kokoro-tts] Ready!", flush=True)

    @modal.method()
    def synthesize_streaming(self, text: str, voice_id: str):
        """Generator that yields NDJSON lines."""
        if voice_id not in VOICES:
            return
        yield from synthesize_streaming_ndjson(text, voice_id, self)

    @modal.method()
    def synthesize(self, text: str, voice_id: str) -> dict:
        """Synthesize speech from text (non-streaming)."""
        if voice_id not in VOICES:
            return {
                "error": f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}"
            }
        audio_base64, sr, duration_ms, word_timestamps = core_synthesize(text, voice_id, self)
        return {
            "audio": audio_base64,
            "sampleRate": sr,
            "durationMs": duration_ms,
            "wordTimestamps": word_timestamps,
        }

    @modal.method()
    def synthesize_batch(self, blocks: list[dict]):
        """Generator that yields NDJSON lines for batch synthesis."""
        yield from synthesize_batch_ndjson(blocks, self)


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel

    web = FastAPI()
    worker = KokoroTTS()

    class SynthesizeRequest(BaseModel):
        text: str
        voiceId: str = "female_1"

    class StreamRequest(BaseModel):
        text: str
        voice_id: str = "female_1"

    @web.post("/synthesize")
    async def synthesize_sync(req: SynthesizeRequest):
        result = await worker.synthesize.remote.aio(req.text, req.voiceId)
        return result

    @web.post("/synthesize/stream")
    async def synthesize_stream(req: StreamRequest):
        import asyncio

        async def ndjson_generator():
            gen = worker.synthesize_streaming.remote_gen.aio(req.text, req.voice_id)
            try:
                async for line in gen:
                    yield line
            except asyncio.CancelledError:
                return
            finally:
                try:
                    await gen.aclose()
                except Exception:
                    pass

        return StreamingResponse(
            ndjson_generator(),
            media_type="application/x-ndjson",
            headers={
                "Transfer-Encoding": "chunked",
                "X-Audio-Sample-Rate": "24000",
                "X-Audio-Channels": "1",
                "X-Audio-Format": "s16le",
            },
        )

    class BatchBlock(BaseModel):
        blockId: str
        text: str
        voiceId: str = "female_1"

    class BatchRequest(BaseModel):
        blocks: list[BatchBlock]

    @web.post("/synthesize/batch")
    async def synthesize_batch(req: BatchRequest):
        import asyncio

        blocks_data = [b.model_dump() for b in req.blocks]

        async def ndjson_generator():
            gen = worker.synthesize_batch.remote_gen.aio(blocks_data)
            try:
                async for line in gen:
                    yield line
            except asyncio.CancelledError:
                return
            finally:
                try:
                    await gen.aclose()
                except Exception:
                    pass

        return StreamingResponse(
            ndjson_generator(),
            media_type="application/x-ndjson",
            headers={"Transfer-Encoding": "chunked"},
        )

    @web.get("/voices")
    async def voices():
        return {"voices": list_voices()}

    @web.get("/health")
    async def health():
        return {"status": "ok"}

    return web
