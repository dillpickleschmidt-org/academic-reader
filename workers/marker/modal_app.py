"""Modal worker for Marker PDF conversion."""

from datetime import datetime, timezone
from pathlib import Path
import json
import time
import modal

_here = Path(__file__).parent

MODEL_CACHE_PATH = "/root/.cache/datalab/"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential")
    .pip_install("marker-pdf==1.9.2", "httpx", "pydantic", "fastapi[standard]")
    .add_local_file(_here / "shared.py", "/root/shared.py")
    .add_local_file(_here / "app/__init__.py", "/root/app/__init__.py")
    .add_local_file(_here / "app/config.py", "/root/app/config.py")
    .add_local_file(_here / "app/conversion.py", "/root/app/conversion.py")
    .add_local_file(_here / "app/html_processing.py", "/root/app/html_processing.py")
    .add_local_file(_here / "app/models.py", "/root/app/models.py")
    .add_local_file(_here.parent / "modal_conversion.py", "/root/modal_conversion.py")
)

app = modal.App("marker", image=image)

models_volume = modal.Volume.from_name("marker-models", create_if_missing=True)


def log_event(**fields):
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "academic-reader-worker",
        "worker": "marker",
        **fields,
    }
    print(
        json.dumps({k: v for k, v in event.items() if v is not None}, default=str),
        flush=True,
    )


@app.cls(
    gpu="L40S",
    retries=3,
    timeout=1800,
    volumes={MODEL_CACHE_PATH: models_volume},
    secrets=[modal.Secret.from_name("google-api-key")],
)
class Marker:
    """Marker worker with persistent models."""

    @modal.enter()
    def load_models(self):
        import sys
        sys.path.insert(0, "/root")
        from marker.models import create_model_dict

        start = time.perf_counter()
        log_event(eventName="models_load_start", method="LIFECYCLE", path="/models/load")
        self.model_dict = create_model_dict()
        models_volume.commit()
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
        use_llm: bool = False,
        force_ocr: bool = False,
        page_range: str | None = None,
    ) -> dict:
        import sys
        sys.path.insert(0, "/root")
        from app.conversion import convert_file
        from modal_conversion import run_conversion_job

        return run_conversion_job(
            worker="marker",
            file_url=file_url,
            result_upload_url=result_upload_url,
            request_id=request_id,
            document_id=document_id,
            user_id=user_id,
            page_range=page_range,
            convert=lambda path: convert_file(
                path,
                use_llm,
                force_ocr,
                page_range,
                artifact_dict=self.model_dict,
            ),
            path="/modal/marker/convert",
            error_code="MARKER_CONVERSION_FAILED",
            extra_fields={"useLlm": use_llm, "forceOcr": force_ocr},
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
    worker = Marker()

    class ConvertRequest(BaseModel):
        file_url: str
        result_upload_url: str
        use_llm: bool = False
        force_ocr: bool = False
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
            req.use_llm,
            req.force_ocr,
            req.page_range,
        )
        return {"id": call.object_id}

    @web.get("/status/{call_id}")
    async def status(call_id: str):
        return await modal_status(call_id)

    return web
