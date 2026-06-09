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
        """Download file, convert with Marker, upload result to S3."""
        import json
        import tempfile
        import sys
        from pathlib import Path

        import httpx

        sys.path.insert(0, "/root")
        from shared import extract_chunks, encode_images
        from marker.config.parser import ConfigParser
        from marker.converters.pdf import PdfConverter
        from marker.renderers.html import HTMLRenderer
        from marker.renderers.markdown import MarkdownRenderer

        start = time.perf_counter()
        suffix = Path(file_url.split("?")[0]).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            r = httpx.get(file_url, follow_redirects=True, timeout=60.0)
            r.raise_for_status()
            f.write(r.content)
            path = Path(f.name)

        try:
            import os
            config = {"output_format": "html", "use_llm": use_llm, "force_ocr": force_ocr}
            if use_llm:
                config["gemini_api_key"] = os.getenv("GOOGLE_API_KEY")
            if page_range:
                config["page_range"] = page_range
            parser = ConfigParser(config)
            converter = PdfConverter(
                config=parser.generate_config_dict(),
                artifact_dict=self.model_dict,
                processor_list=parser.get_processors(),
                renderer=parser.get_renderer(),
            )
            doc = converter.build_document(str(path))

            html = HTMLRenderer({"add_block_ids": True})(doc)
            md = MarkdownRenderer()(doc)
            chunks = extract_chunks(doc)

            result = {
                "content": html.html,
                "metadata": html.metadata,
                "formats": {"html": html.html, "markdown": md.markdown, "chunks": chunks},
                "images": encode_images(html.images) if html.images else None,
            }

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
                path="/modal/marker/convert",
                status=200,
                durationMs=round((time.perf_counter() - start) * 1000),
                useLlm=use_llm,
                forceOcr=force_ocr,
                pageRange=page_range,
                chunkCount=len(chunks.get("blocks", [])),
                imageCount=len(html.images) if html.images else 0,
            )
            return {"s3_result": True}
        except Exception as e:
            log_event(
                eventName="conversion_failed",
                requestId=request_id,
                documentId=document_id,
                userId=user_id,
                method="BACKGROUND",
                path="/modal/marker/convert",
                status=500,
                durationMs=round((time.perf_counter() - start) * 1000),
                useLlm=use_llm,
                forceOcr=force_ocr,
                pageRange=page_range,
                errorCategory="internal",
                errorMessage=str(e),
                errorCode="MARKER_CONVERSION_FAILED",
            )
            raise
        finally:
            path.unlink(missing_ok=True)


# HTTP API for job submission and polling
@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from pydantic import BaseModel

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
        try:
            fc = modal.FunctionCall.from_id(call_id)
            out = await fc.get.aio(timeout=0)
            return {"status": "COMPLETED", "output": out}
        except TimeoutError:
            return {"status": "IN_PROGRESS"}
        except Exception as e:
            return {"status": "FAILED", "error": str(e)}

    return web
