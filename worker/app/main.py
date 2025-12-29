import uuid
import tempfile
import threading
import httpx
import base64
import logging
import re
from io import BytesIO
from pathlib import Path
from fastapi import FastAPI, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from bs4 import BeautifulSoup, NavigableString
import latex2mathml.converter


class PollFilter(logging.Filter):
    """Filter out noisy polling requests from access logs."""
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/jobs/" not in msg


logging.getLogger("uvicorn.access").addFilter(PollFilter())

app = FastAPI(title="Academic Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(tempfile.gettempdir()) / "academic-reader-uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".odt",
    ".xlsx", ".xls", ".ods",
    ".pptx", ".ppt", ".odp",
    ".html", ".epub",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff"
}


def get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def embed_images_as_base64(html: str, images: dict, jpeg_quality: int = 85) -> str:
    """Replace image src references with base64 data URLs."""
    if not images:
        return html

    for image_name, pil_image in images.items():
        buffer = BytesIO()
        # Convert to RGB if necessary (JPEG doesn't support RGBA)
        if pil_image.mode in ("RGBA", "P"):
            pil_image = pil_image.convert("RGB")
        pil_image.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
        b64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        # Replace src reference with data URL
        data_url = f"data:image/jpeg;base64,{b64_data}"
        html = html.replace(f"src='{image_name}'", f'src="{data_url}"')
        html = html.replace(f'src="{image_name}"', f'src="{data_url}"')

    return html


def enhance_html_for_reader(html: str) -> str:
    """Apply reader enhancements to HTML: citations, continuations, figure captions, etc."""
    soup = BeautifulSoup(html, "html.parser")

    # Citation pattern: [Author et al. Year], [Author Year], [Author and Author Year]
    citation_pattern = re.compile(
        r'\[([A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?'
        r'(?:\s+\d{4})?(?:;\s*[A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?'
        r'(?:\s+\d{4})?)*)\]'
    )

    # Process text nodes to wrap citations
    for text_node in soup.find_all(string=True):
        if text_node.parent.name in ("script", "style"):
            continue
        text = str(text_node)
        if not citation_pattern.search(text):
            continue

        parts = []
        last_end = 0
        for match in citation_pattern.finditer(text):
            if match.start() > last_end:
                parts.append(NavigableString(text[last_end:match.start()]))
            span = soup.new_tag("span")
            span["class"] = "citation"
            span.string = match.group(0)
            parts.append(span)
            last_end = match.end()
        if last_end < len(text):
            parts.append(NavigableString(text[last_end:]))

        if parts:
            for i, part in enumerate(parts):
                if i == 0:
                    text_node.replace_with(part)
                else:
                    parts[i - 1].insert_after(part)

    # Find first h1 and remove junk before it
    h1 = soup.find("h1")
    if h1:
        for sibling in list(h1.previous_siblings):
            sibling.decompose()

        # Mark author/metadata paragraphs (short paragraphs between h1 and first h2)
        el = h1.find_next_sibling()
        while el and el.name not in ("h1", "h2"):
            if el.name == "p" and len(el.get_text(strip=True)) < 200:
                el["class"] = el.get("class", []) + ["author-meta"]
            el = el.find_next_sibling()

    # Mark figure captions and continuation paragraphs
    for p in soup.find_all("p"):
        text = " ".join(p.get_text().split()).strip()
        if re.match(r'^Fig\.\s*\d', text):
            p["class"] = p.get("class", []) + ["figure-caption"]
        elif text and text[0].islower():
            p["class"] = p.get("class", []) + ["continuation"]

    # Convert <math> tags to MathML with LaTeX fallback for KaTeX
    for math_el in soup.find_all("math"):
        latex = math_el.get_text(strip=True)
        if latex:
            try:
                mathml = latex2mathml.converter.convert(latex)
                # Wrap in container with data-latex for KaTeX progressive enhancement
                wrapper = soup.new_tag("span")
                wrapper["class"] = "math-render"
                wrapper["data-latex"] = latex
                mathml_soup = BeautifulSoup(mathml, "html.parser")
                wrapper.append(mathml_soup)
                math_el.replace_with(wrapper)
            except Exception:
                # Leave original if conversion fails
                pass

    return str(soup)


def validate_file_extension(filename: str):
    ext = get_file_extension(filename)
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )


def run_conversion(job_id: str, file_path: Path, output_format: str, use_llm: bool, force_ocr: bool, page_range: str | None):
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "processing"

        from marker.converters.pdf import PdfConverter
        from marker.models import create_model_dict
        from marker.config.parser import ConfigParser

        config_dict = {
            "output_format": output_format,
            "use_llm": use_llm,
            "force_ocr": force_ocr,
        }
        if page_range:
            config_dict["page_range"] = page_range

        config_parser = ConfigParser(config_dict)
        converter = PdfConverter(
            config=config_parser.generate_config_dict(),
            artifact_dict=create_model_dict(),
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer(),
        )
        result = converter(str(file_path))

        if output_format == "html":
            content = result.html
            if hasattr(result, 'images') and result.images:
                content = embed_images_as_base64(content, result.images)
            content = enhance_html_for_reader(content)
        elif output_format == "json":
            import json
            content = json.dumps(result.model_dump() if hasattr(result, 'model_dump') else str(result))
        else:
            content = result.markdown

        with jobs_lock:
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = {
                "content": content,
                "metadata": result.metadata,
            }
    except Exception as e:
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = str(e)
    finally:
        if file_path.exists():
            file_path.unlink()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    validate_file_extension(file.filename)

    file_id = str(uuid.uuid4())
    ext = get_file_extension(file.filename)
    file_path = UPLOAD_DIR / f"{file_id}{ext}"

    content = await file.read()
    file_path.write_bytes(content)

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(content),
    }


@app.post("/fetch-url")
async def fetch_url(url: str):
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            response = await client.get(url)
            response.raise_for_status()

        filename = url.split("/")[-1].split("?")[0]
        if not filename or "." not in filename:
            cd = response.headers.get("content-disposition", "")
            if "filename=" in cd:
                filename = cd.split("filename=")[-1].strip('"\'')
            else:
                filename = "document.pdf"

        validate_file_extension(filename)

        file_id = str(uuid.uuid4())
        ext = get_file_extension(filename)
        file_path = UPLOAD_DIR / f"{file_id}{ext}"

        file_path.write_bytes(response.content)

        return {
            "file_id": file_id,
            "filename": filename,
            "size": len(response.content),
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")


@app.post("/convert/{file_id}")
async def convert(
    file_id: str,
    background_tasks: BackgroundTasks,
    output_format: str = "html",
    use_llm: bool = False,
    force_ocr: bool = False,
    page_range: str | None = None,
):
    matching_files = list(UPLOAD_DIR.glob(f"{file_id}.*"))
    if not matching_files:
        raise HTTPException(status_code=404, detail="File not found. Upload first.")

    file_path = matching_files[0]
    job_id = str(uuid.uuid4())

    with jobs_lock:
        jobs[job_id] = {
            "status": "pending",
            "file_id": file_id,
            "output_format": output_format,
        }

    background_tasks.add_task(
        run_conversion,
        job_id,
        file_path,
        output_format,
        use_llm,
        force_ocr,
        page_range,
    )

    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
    }

    if job["status"] == "completed":
        response["result"] = job["result"]
    elif job["status"] == "failed":
        response["error"] = job.get("error", "Unknown error")

    return response
