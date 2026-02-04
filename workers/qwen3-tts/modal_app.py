"""Modal worker for Qwen3-TTS."""

import modal
from pathlib import Path

VOICES_DIR = Path(__file__).parent / "voices"

flash_attn_wheel = "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu12torch2.8cxx11abiFALSE-cp312-cp312-linux_x86_64.whl"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1", "sox", "git")
    .env({
        "TORCHINDUCTOR_COMPILE_THREADS": "1",
        "CUDA_MODULE_LOADING": "LAZY",
    })
    .pip_install(
        "torch==2.8.0",
        "torchaudio==2.8.0",
        flash_attn_wheel,
        extra_index_url="https://download.pytorch.org/whl/cu126",
    )
    .run_commands("pip install --no-cache-dir git+https://github.com/Dillpickleschmidt/nano-qwen3tts-vllm.git@4ce5575 xxhash")
    .run_commands(
        'python -c "from huggingface_hub import snapshot_download; snapshot_download(\'Qwen/Qwen3-TTS-12Hz-1.7B-Base\'); snapshot_download(\'Qwen/Qwen3-TTS-Tokenizer-12Hz\')"',
    )
    .pip_install("faster-whisper==1.2.1")
    .run_commands(
        'python -c "from faster_whisper import WhisperModel; WhisperModel(\'tiny.en\')"',
    )
    .run_commands(
        'python -c "from torchaudio.pipelines import MMS_FA; MMS_FA.get_model()"',
    )
    .add_local_dir(VOICES_DIR, remote_path="/voices")
    .add_local_dir(Path(__file__).parent / "core", remote_path="/root/core")
)

app = modal.App("qwen3-tts", image=image)

snapshot_key = "v112"

with image.imports():
    import sys
    sys.path.insert(0, "/root")

    import torch

    from core.voices import VOICES, list_voices
    from core.synthesis import synthesize as core_synthesize, synthesize_streaming_ndjson


@app.cls(
    gpu="A10G",
    cpu=2.0,
    memory=8192,
    timeout=300,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Qwen3TTS:
    """Qwen3-TTS worker - testing GPU snapshots."""

    @modal.enter(snap=True)
    def load_snap(self):
        """Full initialization in snap=True for GPU snapshot."""
        import os
        import time

        print("[qwen3-tts] Starting full initialization...", flush=True)

        # Set up CUDA
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.set_default_device("cuda")
        torch.set_default_dtype(torch.bfloat16)
        torch.set_float32_matmul_precision("high")

        # Get model paths
        model_path = os.path.expanduser("~/.cache/huggingface/hub/models--Qwen--Qwen3-TTS-12Hz-1.7B-Base/snapshots")
        snapshots = os.listdir(model_path)
        self._model_path = os.path.join(model_path, snapshots[0])

        tokenizer_path = os.path.expanduser("~/.cache/huggingface/hub/models--Qwen--Qwen3-TTS-Tokenizer-12Hz/snapshots")
        tokenizer_snapshots = os.listdir(tokenizer_path)
        self._tokenizer_path = os.path.join(tokenizer_path, tokenizer_snapshots[0])

        # Import
        from nano_qwen3tts_vllm.interface import Qwen3TTSInterface
        from nano_qwen3tts_vllm.utils.voice_clone import load_voice_prompt
        from nano_qwen3tts_vllm.utils.speech_tokenizer_cudagraph import SpeechTokenizerCUDAGraph

        # Create interface
        print(f"[qwen3-tts] Creating interface...", flush=True)
        t0 = time.perf_counter()
        self.interface = Qwen3TTSInterface(
            model_path=self._model_path,
            enforce_eager=False,  # Enable CUDA graphs
        )
        print(f"[qwen3-tts] Interface created ({time.perf_counter()-t0:.1f}s)", flush=True)

        # Load speech tokenizer with CUDA graphs
        print("[qwen3-tts] Loading speech tokenizer...", flush=True)
        self.speech_tokenizer = SpeechTokenizerCUDAGraph(
            model_path=self._tokenizer_path,
            device="cuda:0",
            num_graph_lengths=0,
        )
        print("[qwen3-tts] Speech tokenizer loaded", flush=True)

        # Load voice prompts
        print("[qwen3-tts] Loading voice prompts...", flush=True)
        self.voice_prompts = {}
        for voice_id, voice in VOICES.items():
            prompt_path = Path("/voices") / voice.prompt_file
            self.voice_prompts[voice_id] = load_voice_prompt(prompt_path, "cuda")
        print(f"[qwen3-tts] Loaded {len(self.voice_prompts)} voice(s)", flush=True)

        # Load faster-whisper for transcription + MMS for alignment
        from faster_whisper import WhisperModel
        from core.alignment import load_mms_model

        print("[qwen3-tts] Loading faster-whisper tiny.en...", flush=True)
        self.whisper_model = WhisperModel("tiny.en", device="cuda", compute_type="int8_float16", device_index=0)
        print("[qwen3-tts] faster-whisper loaded", flush=True)

        print("[qwen3-tts] Loading MMS alignment...", flush=True)
        self.mms_model = load_mms_model("cuda")
        print("[qwen3-tts] MMS loaded", flush=True)

        # Warmup
        print("[qwen3-tts] Running warmup...", flush=True)
        self._warmup()
        print("[qwen3-tts] Warmup complete", flush=True)

        torch.cuda.empty_cache()
        print(f"[qwen3-tts] snap=True complete, ready for snapshot {snapshot_key}", flush=True)

    @modal.enter(snap=False)
    def post_restore(self):
        """After restore - verify everything survived."""
        print(f"[qwen3-tts] snap=False: Restored from snapshot {snapshot_key}", flush=True)
        print(f"[qwen3-tts] CUDA available: {torch.cuda.is_available()}", flush=True)
        print(f"[qwen3-tts] Interface: {self.interface is not None}", flush=True)
        print(f"[qwen3-tts] Speech tokenizer: {self.speech_tokenizer is not None}", flush=True)
        print(f"[qwen3-tts] Voice prompts: {len(self.voice_prompts)}", flush=True)
        print(f"[qwen3-tts] Whisper model: {self.whisper_model is not None}", flush=True)
        print(f"[qwen3-tts] MMS model: {self.mms_model is not None}", flush=True)
        print("[qwen3-tts] Ready!", flush=True)

    def _warmup(self):
        """Warmup inference to compile kernels before CUDA graph capture."""
        warmup_text = "Hello, this is a warmup."
        voice_id = list(self.voice_prompts.keys())[0]
        voice_prompt = self.voice_prompts[voice_id]

        audio_codes = []
        for codebook_ids in self.interface.generate_voice_clone(
            text=warmup_text,
            voice_clone_prompt=voice_prompt,
            language="english",
        ):
            audio_codes.append(codebook_ids)

        if audio_codes:
            codes_tensor = torch.tensor(audio_codes, device="cuda")
            _, _ = self.speech_tokenizer.decode_codec_ids(codes_tensor.unsqueeze(0).transpose(1, 2))

        print("[qwen3-tts] Warmup complete", flush=True)

    @modal.method()
    def synthesize_streaming(self, text: str, voice_id: str):
        """Generator that yields NDJSON lines: audio chunks and word timestamps."""
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


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel

    web = FastAPI()
    worker = Qwen3TTS()

    class SynthesizeRequest(BaseModel):
        text: str
        voiceId: str = "male_1"

    class StreamRequest(BaseModel):
        text: str
        voice_id: str = "male_1"

    @web.post("/synthesize")
    async def synthesize_sync(req: SynthesizeRequest):
        """Synthesize speech synchronously (non-streaming)."""
        result = await worker.synthesize.remote.aio(req.text, req.voiceId)
        return result

    @web.post("/synthesize/stream")
    async def synthesize_stream(req: StreamRequest):
        """Stream audio as NDJSON with interleaved timestamps."""
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

    @web.get("/voices")
    async def voices():
        return {"voices": list_voices()}

    @web.get("/health")
    async def health():
        return {"status": "ok"}

    return web
