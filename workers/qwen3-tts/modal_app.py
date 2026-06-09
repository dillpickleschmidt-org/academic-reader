"""Modal worker for official vLLM-Omni Qwen3-TTS serving."""

import subprocess
from pathlib import Path

import modal

CUSTOM_VOICES_DIR = Path(__file__).parent / "custom_voices"
DEPLOY_CONFIG_PATH = Path(__file__).parent / "qwen3_tts.yaml"
VLLM_OMNI_REF = "b8f68174adda0dbe478193e86b5122347cdfb2ae"

image = (
    modal.Image.from_registry("vllm/vllm-openai:v0.22.0")
    .entrypoint([])
    .apt_install("ffmpeg", "git", "libsndfile1", "sox")
    .run_commands("ln -sf $(command -v python3) /usr/local/bin/python")
    .run_commands(
        f"python3 -m pip install --no-cache-dir git+https://github.com/vllm-project/vllm-omni.git@{VLLM_OMNI_REF}",
    )
    .run_commands(
        'python3 -c "from huggingface_hub import snapshot_download; snapshot_download(\'Qwen/Qwen3-TTS-12Hz-1.7B-Base\')"',
    )
    .add_local_dir(CUSTOM_VOICES_DIR, remote_path="/app/custom_voices")
    .add_local_file(Path(__file__).parent / "app/__init__.py", remote_path="/app/app/__init__.py")
    .add_local_file(Path(__file__).parent / "app/main.py", remote_path="/app/app/main.py")
    .add_local_file(DEPLOY_CONFIG_PATH, remote_path="/app/qwen3_tts.yaml")
)

app = modal.App("qwen3-tts", image=image)


@app.function(
    gpu="A10G",
    cpu=4.0,
    memory=24576,
    timeout=600,
    scaledown_window=60,
)
@modal.web_server(8002, startup_timeout=300)
def api():
    subprocess.Popen(["python3", "-m", "app.main"], cwd="/app")
