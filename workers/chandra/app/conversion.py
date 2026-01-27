"""CHANDRA conversion logic using chandra-ocr SDK."""
import base64
import io
from pathlib import Path

from PIL import Image

from .models import get_or_create_manager

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}


def pil_to_base64(img: Image.Image, format: str = "PNG") -> str:
    """Convert PIL Image to base64 string."""
    buffer = io.BytesIO()
    img.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def convert_file(file_path: Path, page_range: str | None = None) -> dict:
    """
    Convert PDF or image file using CHANDRA.

    Args:
        file_path: Path to PDF or image file
        page_range: Optional page range string like "1-5" or "1,3,5"

    Returns:
        dict with structure:
        {
            "content": html_content,
            "metadata": {"page_count": N, "processor": "chandra"},
            "formats": {
                "html": html_content,
                "markdown": markdown_content,
                "json": None,
                "chunks": {"blocks": [...]},
            },
            "images": {"image_N.png": "base64...", ...}
        }
    """
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        return _convert_pdf(file_path, page_range)
    elif suffix in IMAGE_EXTENSIONS:
        return _convert_image(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


def _convert_pdf(pdf_path: Path, page_range: str | None) -> dict:
    """Convert a PDF file using CHANDRA."""
    from chandra.model import BatchInputItem
    from chandra.input import load_pdf_images, parse_range_str

    # Load images from PDF for specified pages
    # CHANDRA's load_pdf_images handles page_range directly
    pdf_images = load_pdf_images(str(pdf_path), page_range=page_range)

    # Parse page range to get page indices for metadata
    pages = parse_range_str(page_range, len(pdf_images)) if page_range else list(range(len(pdf_images)))

    # Create batch items for each page
    batch_items = [
        BatchInputItem(image=img, prompt_type="ocr_layout")
        for img in pdf_images
    ]

    # Run inference
    manager = get_or_create_manager()
    results = manager.generate(batch_items)

    # Combine results from all pages
    html_parts: list[str] = []
    markdown_parts: list[str] = []
    all_chunks: list[dict] = []
    all_images: dict[str, str] = {}
    image_counter = 0

    for idx, result in enumerate(results):
        # CHANDRA returns HTML with proper table structure (rowspan/colspan)
        page_html = result.html if hasattr(result, "html") else ""
        page_markdown = result.markdown if hasattr(result, "markdown") else ""

        html_parts.append(page_html)
        markdown_parts.append(page_markdown)

        # Extract chunks if available
        if hasattr(result, "chunks") and result.chunks:
            for chunk in result.chunks:
                all_chunks.append({
                    "page": pages[idx] + 1 if idx < len(pages) else idx + 1,  # 1-indexed for output
                    "type": getattr(chunk, "type", "text"),
                    "content": getattr(chunk, "content", ""),
                    "bbox": getattr(chunk, "bbox", None),
                })

        # Extract images if available
        if hasattr(result, "images") and result.images:
            for img_name, img_data in result.images.items():
                image_counter += 1
                new_name = f"image_{image_counter}.png"
                if isinstance(img_data, Image.Image):
                    all_images[new_name] = pil_to_base64(img_data)
                elif isinstance(img_data, str):
                    all_images[new_name] = img_data

    # Join pages with horizontal rule separator
    html_content = "\n<hr>\n".join(html_parts)
    markdown_content = "\n\n---\n\n".join(markdown_parts)

    return {
        "content": html_content,
        "metadata": {"page_count": len(pdf_images), "processor": "chandra"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "json": None,
            "chunks": {"blocks": all_chunks} if all_chunks else None,
        },
        "images": all_images if all_images else None,
    }


def _convert_image(image_path: Path) -> dict:
    """Convert a single image file using CHANDRA."""
    from chandra.model import BatchInputItem
    from chandra.input import load_image

    # Load image
    img = load_image(str(image_path))

    # Create batch item
    batch_item = BatchInputItem(image=img, prompt_type="ocr_layout")

    # Run inference
    manager = get_or_create_manager()
    results = manager.generate([batch_item])
    result = results[0]

    # Extract content
    html_content = result.html if hasattr(result, "html") else ""
    markdown_content = result.markdown if hasattr(result, "markdown") else ""

    # Extract chunks
    chunks: list[dict] = []
    if hasattr(result, "chunks") and result.chunks:
        for chunk in result.chunks:
            chunks.append({
                "page": 1,
                "type": getattr(chunk, "type", "text"),
                "content": getattr(chunk, "content", ""),
                "bbox": getattr(chunk, "bbox", None),
            })

    # Extract images
    all_images: dict[str, str] = {}
    if hasattr(result, "images") and result.images:
        image_counter = 0
        for img_name, img_data in result.images.items():
            image_counter += 1
            new_name = f"image_{image_counter}.png"
            if isinstance(img_data, Image.Image):
                all_images[new_name] = pil_to_base64(img_data)
            elif isinstance(img_data, str):
                all_images[new_name] = img_data

    return {
        "content": html_content,
        "metadata": {"page_count": 1, "processor": "chandra"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "json": None,
            "chunks": {"blocks": chunks} if chunks else None,
        },
        "images": all_images if all_images else None,
    }
