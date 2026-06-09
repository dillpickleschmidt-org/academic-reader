"""Launch official vLLM-Omni Qwen3-TTS serving."""

import json
import os
import subprocess
from pathlib import Path

import torch
from safetensors.torch import save_file

from tts_manifest import voices_for_engine

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
PORT = os.environ.get("PORT", "8002")
GPU_MEMORY_UTILIZATION = os.environ.get("GPU_MEMORY_UTILIZATION", "0.9")
VOICE_SOURCE_DIR = Path(os.environ.get("QWEN3_VOICE_SOURCE_DIR", "/app/voices"))
VOICE_OUTPUT_DIR = Path(os.environ.get("QWEN3_CUSTOM_VOICE_DIR", "/tmp/qwen3-voices"))
DEPLOY_TEMPLATE_PATH = Path(os.environ.get("QWEN3_DEPLOY_TEMPLATE", "/app/qwen3_tts.yaml"))
DEPLOY_CONFIG_PATH = Path(os.environ.get("QWEN3_DEPLOY_CONFIG", "/tmp/qwen3_tts.yaml"))


def main() -> None:
    prepare_custom_voices()
    write_deploy_config()
    subprocess.run([
        "vllm-omni",
        "serve",
        MODEL,
        "--deploy-config",
        str(DEPLOY_CONFIG_PATH),
        "--host",
        "0.0.0.0",
        "--port",
        PORT,
        "--gpu-memory-utilization",
        GPU_MEMORY_UTILIZATION,
        "--trust-remote-code",
        "--omni",
    ], check=True)


def prepare_custom_voices() -> None:
    VOICE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": 1,
        "model_type": "qwen3_tts",
        "model": MODEL,
        "hidden_size": None,
        "voices": {},
    }

    for voice in voices_for_engine("qwen3"):
        voice_id = voice["id"]
        source_path = VOICE_SOURCE_DIR / voice["qwen3"]["promptFile"]
        item = load_voice_item(source_path)
        speaker_embedding = item["ref_spk_embedding"].float().cpu().contiguous()
        output_name = f"{voice_id}.safetensors"
        tensors = {"speaker_embedding": speaker_embedding}

        ref_code = item.get("ref_code")
        mode = "xvec"
        if ref_code is not None:
            tensors["ref_code"] = ref_code.to(dtype=torch.int32, device="cpu").contiguous()
            mode = "icl"

        save_file(tensors, str(VOICE_OUTPUT_DIR / output_name))
        manifest["hidden_size"] = int(speaker_embedding.numel())
        manifest["voices"][voice_id] = {
            "name": voice_id,
            "file": output_name,
            "mode": mode,
            "embedding_dim": int(speaker_embedding.numel()),
        }
        if item.get("ref_text"):
            manifest["voices"][voice_id]["ref_text"] = item["ref_text"]
        if ref_code is not None:
            manifest["voices"][voice_id]["ref_code_length"] = int(ref_code.shape[0])

    (VOICE_OUTPUT_DIR / "custom_voice_manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def load_voice_item(path: Path) -> dict:
    payload = torch.load(path, map_location="cpu", weights_only=True)
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        raise ValueError(f"Invalid Qwen3 voice prompt: {path}")
    if "ref_spk_embedding" not in items[0]:
        raise ValueError(f"Missing speaker embedding in Qwen3 voice prompt: {path}")
    return items[0]


def write_deploy_config() -> None:
    config = DEPLOY_TEMPLATE_PATH.read_text(encoding="utf-8")
    DEPLOY_CONFIG_PATH.write_text(
        f"{config.rstrip()}\n\ncustom_voice_dir: {VOICE_OUTPUT_DIR}\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
