"""Thread-safe model loading for Qwen3-TTS using nano_qwen3tts_vllm."""

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import torch


@dataclass
class ModelCache:
    """Cached model instances."""

    interface: "Qwen3TTSInterface"
    speech_tokenizer: "SpeechTokenizerCUDAGraph"
    voice_prompts: dict


_model_cache: Optional[ModelCache] = None
_model_lock = threading.Lock()


def get_model_path() -> str:
    """Get the path to the Qwen3-TTS model."""
    cache_dir = os.path.expanduser("~/.cache/huggingface/hub/models--Qwen--Qwen3-TTS-12Hz-1.7B-Base/snapshots")
    if os.path.exists(cache_dir):
        snapshots = os.listdir(cache_dir)
        if snapshots:
            return os.path.join(cache_dir, snapshots[0])
    return "Qwen/Qwen3-TTS-12Hz-1.7B-Base"


def get_or_create_model() -> ModelCache:
    """Get cached models or create them.

    Thread-safe model initialization. Models are loaded once and cached
    for reuse across all synthesis requests.
    """
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Loading nano_qwen3tts_vllm interface...", flush=True)
            start = time.time()

            from nano_qwen3tts_vllm.interface import Qwen3TTSInterface
            from nano_qwen3tts_vllm.utils.voice_clone import load_voice_prompt
            from nano_qwen3tts_vllm.utils.speech_tokenizer_cudagraph import SpeechTokenizerCUDAGraph

            from core.voices import VOICES

            model_path = get_model_path()
            print(f"[models] Using model path: {model_path}", flush=True)

            torch.backends.cudnn.benchmark = True
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.set_float32_matmul_precision("high")

            interface = Qwen3TTSInterface(
                model_path=model_path,
                enforce_eager=False,
            )
            print(f"[models] Interface loaded in {time.time() - start:.1f}s", flush=True)

            print("[models] Loading speech tokenizer with CUDA graphs...", flush=True)
            speech_tokenizer = SpeechTokenizerCUDAGraph(
                model_path=model_path,
                device="cuda:0",
                num_graph_lengths=100,
            )
            print("[models] Speech tokenizer loaded", flush=True)

            print("[models] Loading voice prompts...", flush=True)
            voice_prompts = {}
            voices_dir = Path(__file__).parent.parent / "voices"
            for voice_id, voice in VOICES.items():
                prompt_path = voices_dir / voice.prompt_file
                voice_prompts[voice_id] = load_voice_prompt(prompt_path, "cuda")
            print(f"[models] Loaded {len(voice_prompts)} voice(s)", flush=True)

            _model_cache = ModelCache(
                interface=interface,
                speech_tokenizer=speech_tokenizer,
                voice_prompts=voice_prompts,
            )

            print("[models] Running warmup...", flush=True)
            _warmup(_model_cache)
            print(f"[models] All models ready in {time.time() - start:.1f}s", flush=True)

        return _model_cache


def _warmup(cache: ModelCache):
    """Warmup to capture CUDA graphs."""
    voice_id = list(cache.voice_prompts.keys())[0]
    voice_prompt = cache.voice_prompts[voice_id]

    audio_codes = []
    for codebook_ids in cache.interface.generate_voice_clone(
        text="Hello, this is a warmup.",
        voice_clone_prompt=voice_prompt,
        language="english",
    ):
        audio_codes.append(codebook_ids)

    if audio_codes:
        codes_tensor = torch.tensor(audio_codes, device="cuda")
        codes_tensor = codes_tensor.unsqueeze(0).transpose(1, 2)
        cache.speech_tokenizer.decode_codec_ids(codes_tensor)


def unload_model() -> bool:
    """Unload models and free GPU memory."""
    global _model_cache
    with _model_lock:
        if _model_cache is None:
            print("[models] Models already unloaded", flush=True)
            return False

        print("[models] Unloading models...", flush=True)
        del _model_cache
        _model_cache = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        print("[models] Models unloaded, VRAM freed", flush=True)
        return True
