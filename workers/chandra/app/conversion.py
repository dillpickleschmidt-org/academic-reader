"""CHANDRA conversion logic using chandra-ocr SDK."""
import base64
import io
from pathlib import Path

from .models import get_or_create_manager

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}

# Parallel processing settings (tuned for H100 80GB)
# SDK uses ThreadPoolExecutor internally with max_workers
MAX_WORKERS = 32  # Concurrent inference threads (SDK default: min(64, batch_size))
BATCH_SIZE = 32   # Pages per batch (CLI default for vllm: 28)


def pil_to_base64(img) -> str:
    """Convert PIL Image to base64 WEBP string (matches chandra SDK format)."""
    buffer = io.BytesIO()
    img.save(buffer, format="WEBP")
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
            "images": {"hash_idx_img.webp": "base64...", ...}
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
    """Convert a PDF file using CHANDRA with parallel batch processing."""
    from chandra.model import BatchInputItem
    from chandra.input import load_pdf_images, parse_range_str

    # Load images from PDF for specified pages
    pdf_images = load_pdf_images(str(pdf_path), page_range=page_range)
    total_pages = len(pdf_images)

    # Parse page range to get page indices for metadata
    pages = parse_range_str(page_range, total_pages) if page_range else list(range(total_pages))

    # Get inference manager
    manager = get_or_create_manager()

    # Process in batches (SDK handles parallelization internally via ThreadPoolExecutor)
    results = []
    for batch_start in range(0, total_pages, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, total_pages)
        batch_images = pdf_images[batch_start:batch_end]

        # Create batch items
        batch_items = [
            BatchInputItem(image=img, prompt_type="ocr_layout")
            for img in batch_images
        ]

        print(f"[chandra] Processing pages {batch_start + 1}-{batch_end} of {total_pages} (max_workers={MAX_WORKERS})", flush=True)

        # SDK's generate() uses ThreadPoolExecutor internally with max_workers
        batch_results = manager.generate(batch_items, max_workers=MAX_WORKERS)
        results.extend(batch_results)

    # Combine results from all pages
    html_parts: list[str] = []
    markdown_parts: list[str] = []
    all_chunks: list[dict] = []
    all_images: dict[str, str] = {}

    for idx, result in enumerate(results):
        # Skip pages with errors (error is a bool in BatchOutputItem)
        if result.error:
            print(f"[chandra] Warning: Page {idx + 1} had an error, skipping", flush=True)
            continue

        if result.html:
            html_parts.append(result.html)
        if result.markdown:
            markdown_parts.append(result.markdown)

        # Extract chunks if available (chunks is a dict with bbox/label/content)
        if result.chunks:
            for chunk in result.chunks:
                chunk_with_page = dict(chunk) if isinstance(chunk, dict) else {"content": str(chunk)}
                chunk_with_page["page"] = pages[idx] + 1 if idx < len(pages) else idx + 1
                all_chunks.append(chunk_with_page)

        if result.images:
            for name, img in result.images.items():
                all_images[name] = pil_to_base64(img)

    # Join pages with horizontal rule separator
    html_content = "\n<hr>\n".join(html_parts)
    markdown_content = "\n\n---\n\n".join(markdown_parts)

    return {
        "content": html_content,
        "metadata": {"page_count": total_pages, "processor": "chandra"},
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
    html_content = result.html or ""
    markdown_content = result.markdown or ""

    # Extract chunks
    chunks: list[dict] = []
    if result.chunks:
        for chunk in result.chunks:
            chunk_with_page = dict(chunk) if isinstance(chunk, dict) else {"content": str(chunk)}
            chunk_with_page["page"] = 1
            chunks.append(chunk_with_page)

    all_images: dict[str, str] = {}
    if result.images:
        for name, img in result.images.items():
            all_images[name] = pil_to_base64(img)

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
