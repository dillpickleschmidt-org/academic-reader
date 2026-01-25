"""vLLM client for LightOnOCR inference."""
import time
import httpx

VLLM_BASE_URL = "http://localhost:8000/v1"
MODEL_NAME = "lightonocr"  # As configured in entrypoint.sh --served-model-name


def wait_for_vllm_server(timeout: int = 300) -> None:
    """Wait for vLLM server to be ready."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{VLLM_BASE_URL}/models", timeout=5)
            if resp.status_code == 200:
                print("[vllm_client] Server ready")
                return
        except httpx.RequestError:
            pass
        time.sleep(2)
    raise RuntimeError("vLLM server did not start in time")


def run_inference(image_base64: str) -> str:
    """
    Run inference on a single page image via vLLM OpenAI API.

    Args:
        image_base64: Base64-encoded PNG/JPEG image data

    Returns:
        Markdown text with optional bbox annotations like:
        ![image](image_1.png)123,456,789,012
    """
    response = httpx.post(
        f"{VLLM_BASE_URL}/chat/completions",
        json={
            "model": MODEL_NAME,
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"}
                }]
            }],
            "max_tokens": 4096,
            "temperature": 0.2,
            "top_p": 0.9,
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]
