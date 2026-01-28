"""Modal worker for CHANDRA conversion."""
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential")
    .pip_install(
        "chandra-ocr",
        "httpx",
        "vllm>=0.11.0",
        "pydantic",
        "fastapi[standard]",
        "pypdfium2",
        "huggingface_hub[hf_transfer]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_commands(
        # Pre-download model
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('datalab-to/chandra')\""
    )
)

app = modal.App("chandra", image=image)


@app.cls(gpu="H100", cpu=2.0, memory=32768, timeout=1800)
class Chandra:
    """CHANDRA worker with persistent vLLM server."""

    @modal.enter()
    def start_vllm(self):
        """Start vLLM server and wait for it to be ready."""
        import subprocess
        import time

        import httpx

        print("[chandra] Starting vLLM server...", flush=True)
        self.vllm_proc = subprocess.Popen(
            [
                "vllm", "serve", "datalab-to/chandra",
                "--dtype", "bfloat16",
                "--max-model-len", "8192",
                "--max-num-seqs", "256",
                "--gpu-memory-utilization", "0.9",
                "--port", "8000",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        # Wait for server to be ready
        base_url = "http://localhost:8000/v1"
        start_time = time.time()
        while time.time() - start_time < 300:
            try:
                resp = httpx.get(f"{base_url}/models", timeout=5)
                if resp.status_code == 200:
                    print(f"[chandra] vLLM ready in {time.time() - start_time:.1f}s", flush=True)
                    break
            except httpx.RequestError:
                pass
            time.sleep(2)
        else:
            raise RuntimeError("vLLM server did not start in time")

        # Initialize InferenceManager
        from chandra.model import InferenceManager
        self.manager = InferenceManager(method="vllm")
        print("[chandra] InferenceManager initialized", flush=True)

    @modal.exit()
    def stop_vllm(self):
        """Stop vLLM server on container shutdown."""
        if hasattr(self, "vllm_proc") and self.vllm_proc:
            self.vllm_proc.terminate()
            self.vllm_proc.wait(timeout=30)
            print("[chandra] vLLM server stopped", flush=True)

    @modal.method()
    def convert(
        self,
        file_url: str,
        result_upload_url: str,
        page_range: str | None = None,
    ) -> dict:
        """Download file, convert with CHANDRA, upload result to S3."""
        import json
        import tempfile
        from pathlib import Path

        import httpx
        from app.conversion import convert_file_with_manager

        # Download file
        suffix = Path(file_url.split("?")[0]).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            r = httpx.get(file_url, follow_redirects=True, timeout=60.0)
            r.raise_for_status()
            f.write(r.content)
            path = Path(f.name)

        try:
            result = convert_file_with_manager(path, self.manager, page_range)
            httpx.put(
                result_upload_url,
                content=json.dumps(result),
                headers={"Content-Type": "application/json"},
                timeout=120.0,
            ).raise_for_status()
            return {"s3_result": True}
        finally:
            path.unlink(missing_ok=True)


@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from pydantic import BaseModel

    web = FastAPI()
    worker = Chandra()

    class ConvertRequest(BaseModel):
        file_url: str
        result_upload_url: str
        page_range: str | None = None

    @web.post("/run")
    async def run(req: ConvertRequest):
        call = await worker.convert.spawn.aio(
            req.file_url, req.result_upload_url, req.page_range
        )
        return {"id": call.object_id}

    @web.get("/status/{call_id}")
    async def status(call_id: str):
        fc = modal.FunctionCall.from_id(call_id)
        try:
            out = await fc.get.aio(timeout=0)
            return {"status": "COMPLETED", "output": out}
        except modal.exception.OutputExpiredError:
            return {"status": "FAILED", "error": "expired"}
        except TimeoutError:
            return {"status": "IN_PROGRESS"}

    return web
