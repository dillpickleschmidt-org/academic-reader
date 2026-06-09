"""Modal worker for official vLLM-Omni Qwen3-TTS serving."""

import subprocess
from pathlib import Path

import modal

ROOT = Path.cwd()
VOICES_DIR = Path(__file__).parent / "voices"
DEPLOY_CONFIG_PATH = Path(__file__).parent / "qwen3_tts.yaml"
MANIFEST_PATH = ROOT / "packages/api-client/src/tts-manifest.json"
TTS_MANIFEST_HELPER_PATH = ROOT / "workers/tts_manifest.py"
VLLM_OMNI_REF = "b8f68174adda0dbe478193e86b5122347cdfb2ae"

if not MANIFEST_PATH.exists():
    MANIFEST_PATH = Path("/root/tts-manifest.json")

if not TTS_MANIFEST_HELPER_PATH.exists():
    TTS_MANIFEST_HELPER_PATH = Path("/root/tts_manifest.py")

image = (
    modal.Image.from_registry("vllm/vllm-openai:v0.22.0")
    .apt_install("ffmpeg", "git", "libsndfile1", "sox")
    .run_commands("ln -sf $(command -v python3) /usr/local/bin/python")
    .run_commands(
        f"python3 -m pip install --no-cache-dir git+https://github.com/vllm-project/vllm-omni.git@{VLLM_OMNI_REF}",
    )
    .run_commands(
        'python3 -c "from huggingface_hub import snapshot_download; snapshot_download(\'Qwen/Qwen3-TTS-12Hz-1.7B-Base\')"',
    )
    .add_local_dir(VOICES_DIR, remote_path="/app/voices")
    .add_local_file(Path(__file__).parent / "app/__init__.py", remote_path="/app/app/__init__.py")
    .add_local_file(Path(__file__).parent / "app/main.py", remote_path="/app/app/main.py")
    .add_local_file(DEPLOY_CONFIG_PATH, remote_path="/app/qwen3_tts.yaml")
    .add_local_file(MANIFEST_PATH, remote_path="/app/tts-manifest.json")
    .add_local_file(TTS_MANIFEST_HELPER_PATH, remote_path="/app/tts_manifest.py")
)

app = modal.App("qwen3-tts", image=image)


@app.function(
    gpu="A10G",
    cpu=4.0,
    memory=24576,
    timeout=600,
    scaledown_window=60,
)
@modal.web_server(8002, startup_timeout=600)
def api():
    subprocess.Popen(["python3", "-m", "app.main"], cwd="/app")
