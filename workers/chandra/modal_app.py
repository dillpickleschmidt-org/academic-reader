"""Modal worker for CHANDRA conversion."""

from datetime import datetime, timezone
from pathlib import Path
import json
import time
import modal

_here = Path(__file__).parent

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
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('datalab-to/chandra')\""
    )
    .add_local_file(_here / "app/__init__.py", "/root/app/__init__.py")
    .add_local_file(_here / "app/conversion.py", "/root/app/conversion.py")
    .add_local_file(_here.parent / "modal_conversion.py", "/root/modal_conversion.py")
)

app = modal.App("chandra", image=image)

snapshot_key = "v1"


def log_event(**fields):
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "academic-reader-worker",
        "worker": "chandra",
        **fields,
    }
    print(
        json.dumps({k: v for k, v in event.items() if v is not None}, default=str),
        flush=True,
    )


with image.imports():
    from vllm import LLM


@app.cls(
    gpu="H100",
    cpu=2.0,
    memory=32768,
    timeout=1800,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Chandra:
    """CHANDRA worker with persistent vLLM model."""

    @modal.enter(snap=True)
    def load_model(self):
        start = time.perf_counter()
        log_event(eventName="models_load_start", method="LIFECYCLE", path="/models/load")
        self.llm = LLM(
            model="datalab-to/chandra",
            dtype="bfloat16",
            max_model_len=8192,
            limit_mm_per_prompt={"image": 1},
            trust_remote_code=True,
            gpu_memory_utilization=0.9,
        )
        log_event(
            eventName="models_load_complete",
            method="LIFECYCLE",
            path="/models/load",
            status=200,
            durationMs=round((time.perf_counter() - start) * 1000),
            snapshotKey=snapshot_key,
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
            worker="chandra",
            file_url=file_url,
            result_upload_url=result_upload_url,
            request_id=request_id,
            document_id=document_id,
            user_id=user_id,
            page_range=page_range,
            convert=lambda path: convert_file_with_llm(path, self.llm, page_range),
            path="/modal/chandra/convert",
            error_code="CHANDRA_CONVERSION_FAILED",
            result_fields=lambda result: {
                "failedPages": result.get("metadata", {}).get("failed_pages"),
            },
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
    worker = Chandra()

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
