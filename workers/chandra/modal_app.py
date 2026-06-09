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
        # Pre-download model
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('datalab-to/chandra')\""
    )
    .add_local_file(_here / "app/__init__.py", "/root/app/__init__.py")
    .add_local_file(_here / "app/conversion.py", "/root/app/conversion.py")
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
        """Load vLLM model for GPU snapshotting."""
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
        """Download file, convert with CHANDRA, upload result to S3."""
        import json
        import tempfile
        from pathlib import Path

        import httpx
        from app.conversion import convert_file_with_llm

        start = time.perf_counter()
        suffix = Path(file_url.split("?")[0]).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            r = httpx.get(file_url, follow_redirects=True, timeout=60.0)
            r.raise_for_status()
            f.write(r.content)
            path = Path(f.name)

        try:
            result = convert_file_with_llm(path, self.llm, page_range)
            chunks = (result.get("formats") or {}).get("chunks") or {}
            httpx.put(
                result_upload_url,
                content=json.dumps(result),
                headers={"Content-Type": "application/json"},
                timeout=120.0,
            ).raise_for_status()
            log_event(
                eventName="conversion_complete",
                requestId=request_id,
                documentId=document_id,
                userId=user_id,
                method="BACKGROUND",
                path="/modal/chandra/convert",
                status=200,
                durationMs=round((time.perf_counter() - start) * 1000),
                pageRange=page_range,
                chunkCount=len(chunks.get("blocks") or []),
                imageCount=len(result.get("images") or {}),
                failedPages=result.get("metadata", {}).get("failed_pages"),
            )
            return {"s3_result": True}
        except Exception as e:
            log_event(
                eventName="conversion_failed",
                requestId=request_id,
                documentId=document_id,
                userId=user_id,
                method="BACKGROUND",
                path="/modal/chandra/convert",
                status=500,
                durationMs=round((time.perf_counter() - start) * 1000),
                pageRange=page_range,
                errorCategory="internal",
                errorMessage=str(e),
                errorCode="CHANDRA_CONVERSION_FAILED",
            )
            raise
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
        fc = modal.FunctionCall.from_id(call_id)
        try:
            out = await fc.get.aio(timeout=0)
            return {"status": "COMPLETED", "output": out}
        except modal.exception.OutputExpiredError:
            return {"status": "FAILED", "error": "expired"}
        except TimeoutError:
            return {"status": "IN_PROGRESS"}

    return web
