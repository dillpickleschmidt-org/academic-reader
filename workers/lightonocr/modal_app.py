"""Modal worker for LightOnOCR conversion."""
from pathlib import Path
import modal

_here = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "poppler-utils")
    .pip_install(
        "vllm>=0.9",
        "pillow",
        "pypdfium2",
        "markdown",
        "httpx",
        "pydantic",
        "fastapi[standard]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .pip_install("huggingface_hub[hf_transfer]")
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('lightonai/LightOnOCR-2-1B-bbox-soup')\""
    )
    .add_local_file(_here / "app/__init__.py", "/root/app/__init__.py")
    .add_local_file(_here / "app/conversion.py", "/root/app/conversion.py")
    .add_local_file(_here / "app/markdown_utils.py", "/root/app/markdown_utils.py")
)

app = modal.App("lightonocr", image=image)


@app.cls(
    gpu="H100",
    cpu=2.0,
    memory=16384,
    timeout=1800,
)
class LightOnOCR:
    """LightOnOCR worker with persistent vLLM model."""

    @modal.enter()
    def load_model(self):
        from vllm import LLM

        print("[lightonocr] Loading vLLM model...", flush=True)
        self.llm = LLM(
            "lightonai/LightOnOCR-2-1B-bbox-soup",
            dtype="bfloat16",
            max_model_len=8192,
            limit_mm_per_prompt={"image": 1},
            gpu_memory_utilization=0.9,
        )
        print("[lightonocr] Model loaded", flush=True)

    @modal.method()
    def convert(
        self,
        file_url: str,
        result_upload_url: str,
        page_range: str | None = None,
    ) -> dict:
        """Download file, convert with LightOnOCR, upload result to S3."""
        import json
        import tempfile
        from pathlib import Path

        import httpx
        from app.conversion import convert_file_with_llm

        # Download file
        suffix = Path(file_url.split("?")[0]).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            r = httpx.get(file_url, follow_redirects=True, timeout=60.0)
            r.raise_for_status()
            f.write(r.content)
            path = Path(f.name)

        try:
            result = convert_file_with_llm(path, self.llm, page_range)
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
    worker = LightOnOCR()

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
