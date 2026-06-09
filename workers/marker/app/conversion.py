import builtins
import json
from datetime import datetime, timezone
from pathlib import Path

from .html_processing import inject_image_dimensions
from .models import get_or_create_models
from ..shared import extract_chunks


def print(*values, flush=False, **kwargs):
    builtins.print(
        json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "academic-reader-worker",
            "worker": "marker",
            "eventName": "worker_lifecycle",
            "message": " ".join(str(value) for value in values),
        }),
        flush=flush,
    )


def _create_converter(
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
):
    """Create a configured PDF converter (without renderer - we'll run all renderers manually)."""
    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter
    from .config import BATCH_SIZE_OVERRIDES

    config_dict = {
        "output_format": "html",
        "use_llm": use_llm,
        "force_ocr": force_ocr,
        **BATCH_SIZE_OVERRIDES,
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


def _render_all_formats(document) -> dict:
    """Run all renderers on the document and return all formats."""
    from marker.renderers.html import HTMLRenderer
    from marker.renderers.markdown import MarkdownRenderer

    html_output = HTMLRenderer({"add_block_ids": True})(document)
    markdown_output = MarkdownRenderer()(document)
    chunks = extract_chunks(document)

    return {
        "html": html_output.html,
        "markdown": markdown_output.markdown,
        "chunks": chunks,
        "images": html_output.images,
        "metadata": html_output.metadata,
    }


def _process_html(html: str, images: dict) -> tuple[str, dict | None]:
    """Process HTML content with image handling.

    Injects image dimensions for layout stability.
    Server handles image upload and URL rewriting.

    Returns:
        Tuple of (html_with_dimensions, images_dict or None)
    """
    if images:
        html = inject_image_dimensions(html, images)
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

    if all_formats["chunks"]:
        print(f"[conversion] Got {len(all_formats['chunks']['blocks'])} chunks")

    return all_formats
