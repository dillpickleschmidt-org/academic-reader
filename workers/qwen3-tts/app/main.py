"""Launch official vLLM-Omni Qwen3-TTS serving."""

import os
import subprocess

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
PORT = os.environ.get("PORT", "8002")
DEPLOY_CONFIG_PATH = os.environ.get("QWEN3_DEPLOY_CONFIG", "/app/qwen3_tts.yaml")


def main() -> None:
    subprocess.run([
        "vllm-omni",
        "serve",
        MODEL,
        "--deploy-config",
        DEPLOY_CONFIG_PATH,
        "--host",
        "0.0.0.0",
        "--port",
        PORT,
        "--trust-remote-code",
        "--omni",
    ], check=True)


if __name__ == "__main__":
    main()
