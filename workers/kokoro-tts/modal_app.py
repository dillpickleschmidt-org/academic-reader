"""Modal worker for Kokoro TTS."""

import base64
import builtins
import json
from datetime import datetime, timezone
import modal
from pathlib import Path

ROOT = Path.cwd()
MANIFEST_PATH = ROOT / "packages/api-client/src/tts-manifest.json"
TTS_MANIFEST_HELPER_PATH = ROOT / "workers/tts_manifest.py"

if not MANIFEST_PATH.exists():
    MANIFEST_PATH = Path("/root/tts-manifest.json")

if not TTS_MANIFEST_HELPER_PATH.exists():
    TTS_MANIFEST_HELPER_PATH = Path("/root/tts_manifest.py")

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
    .add_local_file(
        MANIFEST_PATH,
        remote_path="/root/tts-manifest.json",
        copy=True,
    )
    .add_local_file(
        TTS_MANIFEST_HELPER_PATH,
        remote_path="/root/tts_manifest.py",
        copy=True,
    )
    .run_commands(
        'python -c "'
        "import sys; sys.path.insert(0, '/root'); "
        "from kokoro import KPipeline; "
        "from tts_manifest import voices_for_engine; "
        "p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M'); "
        "[p.load_voice(v['kokoro']['voice']) for v in voices_for_engine('kokoro')]; "
        "print('Kokoro cached')"
        '"'
    )
    .add_local_dir(Path(__file__).parent / "core", remote_path="/root/core")
)

app = modal.App("kokoro-tts", image=image)

snapshot_key = "v2"
TIMEOUT_SECONDS = 300


def print(*values, flush=False, **kwargs):
    builtins.print(
        json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "academic-reader-worker",
            "worker": "kokoro-tts",
            "eventName": "worker_lifecycle",
            "message": " ".join(str(value) for value in values),
        }),
        flush=flush,
    )

with image.imports():
    import sys
    sys.path.insert(0, "/root")

    from core.voices import VOICES
    from core.synthesis import synthesize
    from tts_manifest import default_voice_id_for_engine


@app.cls(
    gpu="T4",
    cpu=2.0,
    memory=8192,
    timeout=TIMEOUT_SECONDS,
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
    def synthesize(self, text: str, voice_id: str):
        """Synthesize one complete PCM response."""
        if voice_id not in VOICES:
            return {"audio": "", "wordTimestamps": []}

        audio, word_timestamps = synthesize(text, voice_id, self)
        return {
            "audio": base64.b64encode(audio).decode("ascii"),
            "wordTimestamps": word_timestamps,
        }


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    web = FastAPI()
    worker = KokoroTTS()

    class SynthesizeRequest(BaseModel):
        text: str
        voice_id: str = default_voice_id_for_engine("kokoro")

    @web.post("/synthesize")
    async def synthesize_route(req: SynthesizeRequest):
        if not req.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        if req.voice_id not in VOICES:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown voice: {req.voice_id}. Available: {list(VOICES.keys())}",
            )

        return await worker.synthesize.remote.aio(req.text, req.voice_id)

    @web.get("/health")
    async def health():
        return {"status": "ok"}

    return web
