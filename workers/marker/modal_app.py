"""Modal worker for Marker PDF conversion."""
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential")
    .pip_install("marker-pdf==1.9.2", "httpx", "pydantic", "fastapi[standard]")
    .run_commands("python -c 'from marker.models import create_model_dict; create_model_dict()'")
)

app = modal.App("marker", image=image)


@app.function(gpu="A100-40GB", cpu=4.0, memory=16384, timeout=1800)
def convert(
    file_url: str,
    result_upload_url: str,
    use_llm: bool = False,
    page_range: str | None = None,
) -> dict:
    """Download file, convert with Marker, upload result to S3."""
    import json
    import tempfile
    from pathlib import Path

    import httpx
    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.renderers.html import HTMLRenderer
    from marker.renderers.markdown import MarkdownRenderer

    # Download
    suffix = Path(file_url.split("?")[0]).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        r = httpx.get(file_url, follow_redirects=True, timeout=60.0)
        r.raise_for_status()
        f.write(r.content)
        path = Path(f.name)

    try:
        # Convert
        config = {"output_format": "html", "use_llm": use_llm}
        if page_range:
            config["page_range"] = page_range
        parser = ConfigParser(config)
        converter = PdfConverter(
            config=parser.generate_config_dict(),
            artifact_dict=create_model_dict(),
            processor_list=parser.get_processors(),
            renderer=parser.get_renderer(),
        )
        doc = converter.build_document(str(path))

        html = HTMLRenderer({"add_block_ids": True})(doc)
        md = MarkdownRenderer()(doc)

        result = {
            "content": html.html,
            "metadata": html.metadata,
            "formats": {"html": html.html, "markdown": md.markdown},
            "images": _encode_images(html.images) if html.images else None,
        }

        # Upload to S3
        httpx.put(
            result_upload_url,
            content=json.dumps(result),
            headers={"Content-Type": "application/json"},
            timeout=120.0,
        ).raise_for_status()
        return {"s3_result": True}
    finally:
        path.unlink(missing_ok=True)


def _encode_images(images: dict) -> dict[str, str]:
    """Convert PIL images to base64 strings."""
    import base64
    import io

    encoded = {}
    for name, img in images.items():
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        encoded[name] = base64.b64encode(buf.getvalue()).decode()
    return encoded


# HTTP API for job submission and polling
@app.function()
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from pydantic import BaseModel

    web = FastAPI()

    class ConvertRequest(BaseModel):
        file_url: str
        result_upload_url: str
        use_llm: bool = False
        page_range: str | None = None

    @web.post("/run")
    async def run(req: ConvertRequest):
        call = await convert.spawn.aio(
            req.file_url, req.result_upload_url, req.use_llm, req.page_range
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
