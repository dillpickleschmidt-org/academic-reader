"""Modal worker for LightOnOCR conversion."""

from datetime import datetime, timezone
from pathlib import Path
import json
import time
import modal

_here = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "poppler-utils")
    .pip_install(
        "vllm>=0.9",
        "xformers",
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
    .add_local_file(_here.parent / "modal_conversion.py", "/root/modal_conversion.py")
)

app = modal.App("lightonocr", image=image)


def log_event(**fields):
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "academic-reader-worker",
        "worker": "lightonocr",
        **fields,
    }
    print(
        json.dumps({k: v for k, v in event.items() if v is not None}, default=str),
        flush=True,
    )


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

        start = time.perf_counter()
        log_event(eventName="models_load_start", method="LIFECYCLE", path="/models/load")
        self.llm = LLM(
            "lightonai/LightOnOCR-2-1B-bbox-soup",
            dtype="bfloat16",
            max_model_len=8192,
            max_num_batched_tokens=32768,
            limit_mm_per_prompt={"image": 1},
            gpu_memory_utilization=0.9,
        )
        log_event(
            eventName="models_load_complete",
            method="LIFECYCLE",
            path="/models/load",
            status=200,
            durationMs=round((time.perf_counter() - start) * 1000),
        )

    @modal.method()
    def convert(
        self,
        file_url: str,
        result_upload_url: str,
        request_id: str,
        document_id: str,
        user_id: str,
        page_range: str | None = None,
    ) -> dict:
        import sys
        sys.path.insert(0, "/root")
        from app.conversion import convert_file_with_llm
        from modal_conversion import run_conversion_job

        return run_conversion_job(
            worker="lightonocr",
            file_url=file_url,
            result_upload_url=result_upload_url,
            request_id=request_id,
            document_id=document_id,
            user_id=user_id,
            page_range=page_range,
            convert=lambda path: convert_file_with_llm(path, self.llm, page_range),
            path="/modal/lightonocr/convert",
            error_code="LIGHTONOCR_CONVERSION_FAILED",
        )


@app.function()
@modal.asgi_app()
def api():
    import sys
    sys.path.insert(0, "/root")
    from fastapi import FastAPI
    from pydantic import BaseModel
    from modal_conversion import modal_status

    web = FastAPI()
    worker = LightOnOCR()

    class ConvertRequest(BaseModel):
        file_url: str
        result_upload_url: str
        page_range: str | None = None
        request_id: str
        document_id: str
        user_id: str

    @web.post("/run")
    async def run(req: ConvertRequest):
        call = await worker.convert.spawn.aio(
            req.file_url,
            req.result_upload_url,
            req.request_id,
            req.document_id,
            req.user_id,
            req.page_range,
        )
        return {"id": call.object_id}

    @web.get("/status/{call_id}")
    async def status(call_id: str):
        return await modal_status(call_id)

    return web
