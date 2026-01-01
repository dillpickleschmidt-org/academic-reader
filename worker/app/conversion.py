import json
import traceback
from pathlib import Path
from typing import Any

from .html_processing import embed_images_as_base64, inject_image_dimensions
from .jobs import update_job
from .models import get_or_create_models
from .progress import clear_queue, set_active_job


def _to_dict(obj: Any) -> Any:
    """Convert pydantic model to dict, or return as-is if already a dict."""
    if hasattr(obj, 'model_dump_json'):
        return json.loads(obj.model_dump_json())
    return obj


def _create_converter(
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
):
    """Create a configured PDF converter (without renderer - we'll run all renderers manually)."""
    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter

    config_dict = {
        "output_format": "html",  # Doesn't matter, we'll use all renderers
        "use_llm": use_llm,
        "force_ocr": force_ocr,
    }
    if page_range:
        config_dict["page_range"] = page_range

    config_parser = ConfigParser(config_dict)
    return PdfConverter(
        config=config_parser.generate_config_dict(),
        artifact_dict=get_or_create_models(),
        processor_list=config_parser.get_processors(),
        renderer=config_parser.get_renderer(),
    )


def _render_all_formats(document: Any) -> dict:
    """Run all renderers on the document and return all formats."""
    from marker.renderers.html import HTMLRenderer
    from marker.renderers.markdown import MarkdownRenderer
    from marker.renderers.json import JSONRenderer

    html_output = HTMLRenderer()(document)
    markdown_output = MarkdownRenderer()(document)
    json_output = JSONRenderer()(document)

    # Try to import ChunkRenderer (may not exist in older versions)
    try:
        from marker.renderers.chunk import ChunkRenderer
        chunk_output = ChunkRenderer()(document)
        chunks = {
            "blocks": [_to_dict(b) for b in chunk_output.blocks],
            "page_info": _to_dict(chunk_output.page_info) if chunk_output.page_info else None,
            "metadata": _to_dict(chunk_output.metadata) if chunk_output.metadata else None,
        } if chunk_output else None
    except ImportError:
        chunks = None

    # Convert JSON output children to plain dicts for serialization
    json_children = None
    if hasattr(json_output, 'children') and json_output.children:
        json_children = [_to_dict(c) for c in json_output.children]

    return {
        "html": html_output.html,
        "markdown": markdown_output.markdown,
        "json": json_children,
        "chunks": chunks,
        "images": html_output.images,
        "metadata": html_output.metadata,
    }


def _process_html(html: str, images: dict, embed_images: bool = True) -> tuple[str, dict | None]:
    """Process HTML content with image handling.

    Returns:
        Tuple of (content, images_dict or None)
        images_dict is returned only when embed_images=False
    """
    if images:
        html = inject_image_dimensions(html, images)
        if embed_images:
            return embed_images_as_base64(html, images), None
        return html, images
    return html, None


def _build_and_render_all(
    file_path: Path,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
) -> dict:
    """Build document once and render to all formats."""
    converter = _create_converter(use_llm, force_ocr, page_range)

    # Build and process document (expensive part)
    document = converter.build_document(str(file_path))

    # Render to all formats (cheap part)
    all_formats = _render_all_formats(document)

    # Log non-HTML formats for future use
    if all_formats["chunks"]:
        print(f"[conversion] Got {len(all_formats['chunks'])} chunks")
    if all_formats["json"]:
        print(f"[conversion] Got JSON with {len(all_formats['json'])} pages")

    return all_formats


def run_conversion_sync(
    file_path: Path,
    output_format: str,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
) -> dict:
    """Synchronous conversion without job tracking. Used by serverless handler."""
    all_formats = _build_and_render_all(file_path, use_llm, force_ocr, page_range)

    # Process HTML with embedded images
    html_content, _ = _process_html(all_formats["html"], all_formats["images"], embed_images=True)

    # Return requested format as content, include all formats
    if output_format == "html":
        content = html_content
    elif output_format == "json":
        content = all_formats["json"]
    elif output_format == "markdown":
        content = all_formats["markdown"]
    else:
        content = html_content

    return {
        "content": content,
        "metadata": all_formats["metadata"],
        "formats": {
            "html": html_content,
            "markdown": all_formats["markdown"],
            "json": all_formats["json"],
            "chunks": all_formats["chunks"],
        },
    }


def run_conversion(
    job_id: str,
    file_path: Path,
    output_format: str,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
) -> None:
    """Run the document conversion in a background thread.

    For HTML output, this uses two phases:
    1. html_ready - HTML without embedded images (fast)
    2. completed - HTML with embedded images (final)
    """
    set_active_job(job_id)

    try:
        update_job(job_id, status="processing")

        all_formats = _build_and_render_all(file_path, use_llm, force_ocr, page_range)

        # Phase 1: HTML without embedded images (for quick preview)
        html_content, images = _process_html(
            all_formats["html"], all_formats["images"], embed_images=False
        )
        update_job(job_id, status="html_ready", html_content=html_content)

        # Phase 2: Embed images
        if images:
            html_with_images = embed_images_as_base64(html_content, images)
        else:
            html_with_images = html_content

        # Return requested format as content
        if output_format == "html":
            content = html_with_images
        elif output_format == "json":
            content = all_formats["json"]
        elif output_format == "markdown":
            content = all_formats["markdown"]
        else:
            content = html_with_images

        update_job(
            job_id,
            status="completed",
            result={
                "content": content,
                "metadata": all_formats["metadata"],
                "formats": {
                    "html": html_with_images,
                    "markdown": all_formats["markdown"],
                    "json": all_formats["json"],
                    "chunks": all_formats["chunks"],
                },
            },
        )
    except FileNotFoundError:
        update_job(job_id, status="failed", error="File not found")
    except ValueError as e:
        update_job(job_id, status="failed", error=f"Invalid input: {e}")
    except Exception as e:
        traceback.print_exc()
        update_job(job_id, status="failed", error=f"Conversion failed: {e}")
    finally:
        set_active_job(None)
        clear_queue(job_id)
        if file_path.exists():
            file_path.unlink()
