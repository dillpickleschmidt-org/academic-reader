"""vLLM subprocess manager for lazy loading."""
import builtins
import json
import subprocess
import threading
import time
from datetime import datetime, timezone
import httpx

VLLM_BASE_URL = "http://localhost:8000/v1"

_vllm_process: subprocess.Popen | None = None
_vllm_lock = threading.Lock()


def print(*values, flush=False, **kwargs):
    builtins.print(
        json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "academic-reader-worker",
            "worker": "lightonocr",
            "eventName": "worker_lifecycle",
            "message": " ".join(str(value) for value in values),
        }),
        flush=flush,
    )


def start_vllm(timeout: int = 300) -> bool:
    """Start vLLM server if not running.

    Blocks until server is ready (up to timeout seconds).
    Returns True if started, False if already running.
    """
    global _vllm_process
    with _vllm_lock:
        if _vllm_process is not None and _vllm_process.poll() is None:
            print("[vllm_manager] vLLM already running", flush=True)
            return False

        print("[vllm_manager] Starting vLLM server...", flush=True)
        start_time = time.time()

        _vllm_process = subprocess.Popen(
            [
                "vllm", "serve", "lightonai/LightOnOCR-2-1B-bbox-soup",
                "--dtype", "bfloat16",
                "--max-model-len", "8192",
                "--limit-mm-per-prompt", '{"image": 1}',
                "--gpu-memory-utilization", "0.9",
                "--served-model-name", "lightonocr",
                "--max-num-batched-tokens", "32768",
                "--mm-processor-cache-gb", "0",
                "--port", "8000",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        # Wait for server to be ready
        while time.time() - start_time < timeout:
            if _vllm_process.poll() is not None:
                raise RuntimeError("vLLM process died unexpectedly")

            try:
                resp = httpx.get(f"{VLLM_BASE_URL}/models", timeout=5)
                if resp.status_code == 200:
                    elapsed = time.time() - start_time
                    print(f"[vllm_manager] vLLM ready in {elapsed:.1f}s", flush=True)
                    return True
            except httpx.RequestError:
                pass
            time.sleep(2)

        raise RuntimeError("vLLM server did not start in time")


def stop_vllm() -> bool:
    """Stop vLLM server and free GPU memory.

    Returns True if stopped, False if not running.
    """
    global _vllm_process
    with _vllm_lock:
        if _vllm_process is None:
            print("[vllm_manager] vLLM not running", flush=True)
            return False

        if _vllm_process.poll() is not None:
            print("[vllm_manager] vLLM already stopped", flush=True)
            _vllm_process = None
            return False

        print("[vllm_manager] Stopping vLLM server...", flush=True)

        # Send SIGTERM for graceful shutdown
        _vllm_process.terminate()

        try:
            _vllm_process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            # Force kill if graceful shutdown fails
            print("[vllm_manager] Force killing vLLM...", flush=True)
            _vllm_process.kill()
            _vllm_process.wait(timeout=10)

        _vllm_process = None
        print("[vllm_manager] vLLM stopped, VRAM freed", flush=True)

        # Clear CUDA cache
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        return True


def is_vllm_running() -> bool:
    """Check if vLLM server is running."""
    with _vllm_lock:
        return _vllm_process is not None and _vllm_process.poll() is None


def ensure_vllm_ready() -> None:
    """Ensure vLLM is running, starting it if needed."""
    if not is_vllm_running():
        start_vllm()
