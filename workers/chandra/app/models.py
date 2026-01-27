"""vLLM manager for CHANDRA (runpod-only)."""
import threading
import time
import httpx

VLLM_BASE_URL = "http://localhost:8000/v1"

_inference_manager = None
_manager_lock = threading.Lock()


def wait_for_vllm_server(timeout: int = 300) -> bool:
    """Wait for vLLM server to be ready."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            resp = httpx.get(f"{VLLM_BASE_URL}/models", timeout=5)
            if resp.status_code == 200:
                return True
        except httpx.RequestError:
            pass
        time.sleep(2)
    return False


def get_or_create_manager():
    """Get or create the CHANDRA InferenceManager (cached singleton)."""
    global _inference_manager
    with _manager_lock:
        if _inference_manager is None:
            from chandra.model import InferenceManager
            # Wait for vLLM (started by entrypoint.sh)
            if not wait_for_vllm_server(timeout=60):
                raise RuntimeError("vLLM server not available")
            _inference_manager = InferenceManager(method="vllm")
            print("[chandra] InferenceManager initialized with vLLM backend", flush=True)
        return _inference_manager
