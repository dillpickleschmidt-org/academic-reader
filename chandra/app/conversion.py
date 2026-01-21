"""Chandra OCR conversion logic."""
import base64
import io
from pathlib import Path
import pypdfium2 as pdfium
from chandra.model import BatchInputItem
from chandra.input import load_pdf_images
from .models import get_or_create_manager


def get_page_count(file_path: Path) -> int:
    """Get total page count from PDF."""
    pdf = pdfium.PdfDocument(str(file_path))
    count = len(pdf)
    pdf.close()
    return count


def pil_to_base64(img) -> str:
    """Convert PIL Image to base64 string."""
    buffer = io.BytesIO()
    img.save(buffer, format="WEBP")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def convert_pdf(file_path: Path, page_range: str | None = None) -> dict:
    """Convert PDF using Chandra OCR."""
    manager = get_or_create_manager()

    # Determine pages to process
    page_count = get_page_count(file_path)
    if page_range:
        from chandra.input import parse_range_str
        pages = parse_range_str(page_range)
    else:
        pages = list(range(page_count))

    # Load PDF pages as images
    images = load_pdf_images(str(file_path), page_range=pages)

    # Create batch input for all pages
    batch_input = [
        BatchInputItem(image=img)
        for img in images
    ]

    # Run inference
    results = manager.generate(batch_input)

    # Combine results from all pages
    html_parts = []
    markdown_parts = []
    all_chunks = []
    all_images = {}

    for i, result in enumerate(results):
        if result.error:
            continue
        if result.html:
            html_parts.append(result.html)
        if result.markdown:
            markdown_parts.append(result.markdown)
        if result.chunks:
            # chunks is a LIST of dicts, each with bbox/label/content
            for chunk in result.chunks:
                chunk_with_page = dict(chunk)
                chunk_with_page['page'] = pages[i]
                all_chunks.append(chunk_with_page)
        if result.images:
            # images is a dict mapping filename -> PIL Image
            # Keep original names to match <img src="..."> in HTML
            for name, img in result.images.items():
                all_images[name] = pil_to_base64(img)

    html_content = "\n".join(html_parts)
    markdown_content = "\n\n---\n\n".join(markdown_parts)

    return {
        "content": html_content,
        "metadata": {"page_count": len(images), "processor": "chandra"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "json": None,
            "chunks": {"blocks": all_chunks} if all_chunks else None,
        },
        "images": all_images if all_images else None,
    }
