import json
from pathlib import Path
from typing import Any

from .html_processing import embed_images_as_base64, inject_image_dimensions
from .models import get_or_create_models


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

    html_output = HTMLRenderer({"add_block_ids": True})(document)
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
        print(f"[conversion] Got {len(all_formats['chunks']['blocks'])} chunks")
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

    # Process HTML once (injects dimensions), then create embedded variant
    html_raw, images = _process_html(all_formats["html"], all_formats["images"], embed_images=False)
    html_embedded = embed_images_as_base64(html_raw, images) if images else html_raw

    # Return requested format as content, include all formats
    if output_format == "html":
        content = html_embedded
    elif output_format == "json":
        content = all_formats["json"]
    elif output_format == "markdown":
        content = all_formats["markdown"]
    else:
        content = html_embedded

    return {
        "content": content,
        "metadata": all_formats["metadata"],
        "formats": {
            "html": html_embedded,
            "html_raw": html_raw,  # For progressive loading (no embedded images)
            "markdown": all_formats["markdown"],
            "json": all_formats["json"],
            "chunks": all_formats["chunks"],
        },
        "images": images,  # For progressive loading
    }
