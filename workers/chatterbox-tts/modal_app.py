"""Modal worker for Chatterbox TTS."""
import modal
from pathlib import Path

# Get the path to voices directory relative to this file
VOICES_DIR = Path(__file__).parent / "voices"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "ffmpeg", "libsndfile1")
    .pip_install(
        "chatterbox-tts",
        "scipy",
        "pydantic",
        "fastapi[standard]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_commands(
        # Pre-download Chatterbox model
        "python -c \"from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained('cpu')\"",
        # Pre-download MMS alignment model
        "python -c \"from torchaudio.pipelines import MMS_FA; MMS_FA.get_model()\"",
    )
    .add_local_dir(VOICES_DIR, remote_path="/voices")
)

app = modal.App("chatterbox-tts", image=image)


@app.cls(gpu="A10G", cpu=2.0, memory=8192, timeout=300)
class ChatterboxTTS:
    """Chatterbox TTS worker with persistent model."""

    @modal.enter()
    def load_model(self):
        import torch
        from chatterbox.tts import ChatterboxTTS as ChatterboxModel
        from torchaudio.pipelines import MMS_FA

        print("[chatterbox-tts] Loading Chatterbox model...", flush=True)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = ChatterboxModel.from_pretrained(device)
        print(f"[chatterbox-tts] Model loaded on {device}", flush=True)

        print("[chatterbox-tts] Loading MMS alignment model...", flush=True)
        self.align_model, self.align_labels = MMS_FA.get_model().to(device), MMS_FA.get_labels()
        self.device = device
        print("[chatterbox-tts] Ready", flush=True)

    @modal.method()
    def synthesize(self, text: str, voice_id: str) -> dict:
        """Synthesize speech from text with word-level timestamps."""
        import base64
        import io
        import numpy as np
        import torch
        from scipy.io import wavfile

        # Voice configs
        voices = {
            "male_2": {"reference_audio": "/voices/male_2.wav", "exaggeration": 0.25, "post_process": True},
            "female_1": {"reference_audio": "/voices/female_1.wav", "exaggeration": 0.25, "post_process": False},
        }

        if voice_id not in voices:
            return {"error": f"Unknown voice: {voice_id}. Available: {list(voices.keys())}"}

        voice = voices[voice_id]

        # Generate audio
        wav = self.model.generate(
            text,
            audio_prompt_path=voice["reference_audio"],
            exaggeration=voice["exaggeration"],
        )
        audio_tensor = wav.squeeze(0)
        sr = self.model.sr

        # Get word timestamps using MMS alignment
        word_timestamps = self._get_word_timestamps(audio_tensor, text, sr)

        # Convert to numpy
        audio = audio_tensor.numpy()

        # Apply compression if configured
        if voice["post_process"]:
            audio = self._compress(audio, sr)

        # Calculate duration
        duration_ms = len(audio) / sr * 1000

        # Convert to WAV bytes
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

    def _get_word_timestamps(self, audio_tensor, text: str, sr: int) -> list[dict]:
        """Compute word-level timestamps using MMS alignment."""
        import torch
        import torchaudio.functional as F

        # Resample to 16kHz for MMS
        if sr != 16000:
            audio_16k = F.resample(audio_tensor.unsqueeze(0), sr, 16000).squeeze(0)
        else:
            audio_16k = audio_tensor

        # Normalize
        audio_16k = audio_16k / audio_16k.abs().max()

        # Get emissions
        with torch.inference_mode():
            emissions, _ = self.align_model(audio_16k.unsqueeze(0).to(self.device))

        # Tokenize text
        words = text.split()
        transcript = "".join(words).upper()

        # Create token indices
        dictionary = {c: i for i, c in enumerate(self.align_labels)}
        tokens = [dictionary.get(c, dictionary.get("<unk>", 0)) for c in transcript]

        if not tokens:
            return []

        # Align
        from torchaudio.functional import forced_align
        alignments, scores = forced_align(emissions, torch.tensor([tokens]).to(self.device), blank=0)

        # Convert frame indices to timestamps
        frame_duration_ms = 1000 * 320 / 16000  # MMS frame duration

        timestamps = []
        char_idx = 0
        for word in words:
            word_chars = word.upper()
            start_frame = None
            end_frame = None

            for c in word_chars:
                if char_idx < len(alignments[0]):
                    frame = alignments[0][char_idx].item()
                    if start_frame is None:
                        start_frame = frame
                    end_frame = frame
                char_idx += 1

            if start_frame is not None and end_frame is not None:
                timestamps.append({
                    "word": word,
                    "startMs": start_frame * frame_duration_ms,
                    "endMs": (end_frame + 1) * frame_duration_ms,
                })

        return timestamps

    def _compress(
        self,
        audio,
        sr: int,
        threshold_db: float = -20,
        ratio: float = 4,
        attack_ms: float = 5,
        release_ms: float = 50,
    ):
        """Apply dynamic range compression."""
        import numpy as np

        eps = 1e-10
        audio_db = 20 * np.log10(np.abs(audio) + eps)
        over_threshold = np.maximum(audio_db - threshold_db, 0)
        gain_reduction_db = over_threshold * (1 - 1 / ratio)

        attack_coef = np.exp(-1 / (attack_ms / 1000 * sr)) if attack_ms > 0 else 0
        release_coef = np.exp(-1 / (release_ms / 1000 * sr)) if release_ms > 0 else 0

        smoothed_gr = np.zeros_like(gain_reduction_db)
        current = 0.0
        for i in range(len(gain_reduction_db)):
            target = gain_reduction_db[i]
            coef = attack_coef if target > current else release_coef
            current = coef * current + (1 - coef) * target
            smoothed_gr[i] = current

        compressed = audio * 10 ** (-smoothed_gr / 20)
        return compressed / np.max(np.abs(compressed)) * 0.99


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from pydantic import BaseModel

    web = FastAPI()
    worker = ChatterboxTTS()

    class SynthesizeRequest(BaseModel):
        segments: list[dict]  # [{text, voice_id}, ...]

    @web.post("/synthesize")
    async def synthesize(req: SynthesizeRequest):
        """Spawn all segments in parallel."""
        calls = []
        for seg in req.segments:
            call = await worker.synthesize.spawn.aio(
                seg.get("text", ""),
                seg.get("voice_id", "female_1"),
            )
            calls.append(call.object_id)
        return {"call_ids": calls}

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
        return {"voices": [
            {"id": "male_2", "displayName": "Male 2"},
            {"id": "female_1", "displayName": "Female 1"},
        ]}

    @web.get("/health")
    async def health():
        return {"status": "ok"}

    return web
