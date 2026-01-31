"""Modal worker for Qwen3-TTS with true streaming support."""

import modal
from pathlib import Path

VOICES_DIR = Path(__file__).parent / "voices"

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.8.0-devel-ubuntu22.04", add_python="3.12"
    )
    .apt_install("build-essential", "ffmpeg", "libsndfile1", "sox", "git")
    .pip_install(
        "qwen-tts",
        "torch",
        "torchaudio",
        "librosa",
        "scipy",
        "soundfile",
        "pydantic",
        "fastapi[standard]",
    )
    .run_commands(
        'python -c "from huggingface_hub import snapshot_download; snapshot_download(\'Qwen/Qwen3-TTS-12Hz-1.7B-Base\')"',
        'python -c "from torchaudio.pipelines import MMS_FA; MMS_FA.get_model()"',
    )
    .add_local_dir(VOICES_DIR, remote_path="/voices")
    .add_local_dir(Path(__file__).parent / "core", remote_path="/root/core")
)

app = modal.App("qwen3-tts", image=image)

# Change this to invalidate the snapshot cache
snapshot_key = "v17"

# Imports deferred to inside Modal image context
with image.imports():
    import torch
    import numpy as np
    from qwen_tts import Qwen3TTSModel
    from torchaudio.pipelines import MMS_FA

    from core.voices import VoiceConfig, VOICES, load_voice_prompt, list_voices
    from core.alignment import compute_word_timestamps
    from core.streaming import generate_streaming


@app.cls(
    gpu="A10G",
    cpu=2.0,
    memory=8192,
    timeout=300,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Qwen3TTS:
    """Qwen3-TTS worker with true streaming support."""

    @modal.enter(snap=True)
    def load_model(self):
        print("[qwen3-tts] Loading qwen-tts model...", flush=True)
        self.tts_model = Qwen3TTSModel.from_pretrained(
            "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
            device_map="cuda:0",
        )
        print("[qwen3-tts] qwen-tts model loaded", flush=True)

        print("[qwen3-tts] Loading MMS alignment model...", flush=True)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.align_model = MMS_FA.get_model().to(device)
        self.align_tokenizer = MMS_FA.get_tokenizer()
        self.align_aligner = MMS_FA.get_aligner()
        self.align_sample_rate = MMS_FA.sample_rate
        self.device = device

        print("[qwen3-tts] Loading voice prompts...", flush=True)
        self.voice_prompts = {}
        for voice_id, voice in VOICES.items():
            prompt_path = Path("/voices") / voice.prompt_file
            self.voice_prompts[voice_id] = load_voice_prompt(prompt_path, "cuda")
        print(f"[qwen3-tts] Loaded {len(self.voice_prompts)} voice(s)", flush=True)

        print(f"[qwen3-tts] Ready, snapshotting {snapshot_key}", flush=True)

    @modal.method()
    def synthesize_streaming(self, text: str, voice_id: str):
        """
        Generator that yields raw PCM audio chunks as codes are generated.
        Each chunk is ~2 seconds of audio (25 codes at 12.5 Hz).
        """
        if voice_id not in VOICES:
            return

        voice_prompt = self.voice_prompts[voice_id]
        voice = VOICES[voice_id]

        for audio_chunk in generate_streaming(
            self.tts_model,
            text=text,
            voice_clone_prompt=voice_prompt,
            language="english",
            chunk_size=25,
            temperature=voice.temperature,
            top_p=voice.top_p,
        ):
            audio_int16 = (audio_chunk * 32767).astype(np.int16)
            yield audio_int16.tobytes()

    @modal.method()
    def synthesize(self, text: str, voice_id: str) -> dict:
        """Synthesize speech from text with word-level timestamps (non-streaming)."""
        import base64
        import io
        from scipy.io import wavfile

        if voice_id not in VOICES:
            return {
                "error": f"Unknown voice: {voice_id}. Available: {list(VOICES.keys())}"
            }

        voice = VOICES[voice_id]
        voice_clone_prompt = self.voice_prompts[voice_id]

        wavs, sr = self.tts_model.generate_voice_clone(
            text=text,
            language="english",
            voice_clone_prompt=voice_clone_prompt,
            temperature=voice.temperature,
            top_p=voice.top_p,
        )

        audio = wavs[0]

        audio_tensor = torch.from_numpy(audio).float()
        word_timestamps = compute_word_timestamps(
            audio_tensor,
            text,
            sr,
            self.align_model,
            self.align_tokenizer,
            self.align_aligner,
            self.align_sample_rate,
            self.device,
        )

        duration_ms = len(audio) / sr * 1000

        audio_int16 = (audio * 32767).astype(np.int16)
        buffer = io.BytesIO()
        wavfile.write(buffer, sr, audio_int16)
        wav_bytes = buffer.getvalue()

        return {
            "audio": base64.b64encode(wav_bytes).decode("utf-8"),
            "sampleRate": sr,
            "durationMs": duration_ms,
            "wordTimestamps": word_timestamps,
        }


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel

    web = FastAPI()
    worker = Qwen3TTS()

    class SynthesizeRequest(BaseModel):
        segments: list[dict]

    class StreamRequest(BaseModel):
        text: str
        voice_id: str = "male_1"

    @web.post("/synthesize")
    async def synthesize(req: SynthesizeRequest):
        """Spawn all segments in parallel (non-streaming with word timestamps)."""
        calls = []
        for seg in req.segments:
            call = await worker.synthesize.spawn.aio(
                seg.get("text", ""),
                seg.get("voice_id", "male_1"),
            )
            calls.append(call.object_id)
        return {"call_ids": calls}

    @web.post("/synthesize/stream")
    async def synthesize_stream(req: StreamRequest):
        """
        Stream audio as it's generated.
        Returns raw PCM s16le audio at 24kHz mono.
        Client plays with: ffplay -f s16le -ar 24000 -ac 1 -
        """

        async def audio_generator():
            async for chunk in worker.synthesize_streaming.remote_gen.aio(
                req.text, req.voice_id
            ):
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

    @web.get("/result/{call_id}")
    async def result(call_id: str):
        fc = modal.FunctionCall.from_id(call_id)
        try:
            out = await fc.get.aio(timeout=0)
            return {"status": "completed", **out}
        except TimeoutError:
            return {"status": "pending"}

    @web.get("/voices")
    async def voices():
        return {"voices": list_voices()}

    @web.get("/health")
    async def health():
        return {"status": "ok"}

    return web
