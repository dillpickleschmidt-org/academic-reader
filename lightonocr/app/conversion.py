"""LightOnOCR conversion logic."""
from pathlib import Path

from PIL import Image

from .vllm_client import run_inference
from .markdown_utils import (
    pil_to_base64,
    resize_image_for_inference,
    render_pdf_page,
    get_pdf_page_count,
    parse_bbox_from_markdown,
    extract_images_from_pdf,
    markdown_to_html,
    parse_page_range,
)


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}


def convert_file(file_path: Path, page_range: str | None = None) -> dict:
    """
    Convert PDF or image file using LightOnOCR.

    Args:
        file_path: Path to PDF or image file
        page_range: Optional page range string like "1-5" or "1,3,5"

    Returns:
        dict with structure:
        {
            "content": html_content,
            "metadata": {"page_count": N, "processor": "lightonocr"},
            "formats": {
                "html": html_content,
                "markdown": markdown_content,
                "json": None,
                "chunks": None,  # Not implemented yet
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
    """Convert a PDF file."""
    total_pages = get_pdf_page_count(pdf_path)
    pages = parse_page_range(page_range, total_pages)

    markdown_parts: list[str] = []
    all_images: dict[str, str] = {}
    image_counter = 0

    for page_idx in pages:
        # Render page to image
        page_image = render_pdf_page(pdf_path, page_idx)
        page_image = resize_image_for_inference(page_image)

        # Run OCR inference
        image_b64 = pil_to_base64(page_image)
        raw_markdown = run_inference(image_b64)

        # Parse bbox annotations and extract images
        cleaned_md, bboxes = parse_bbox_from_markdown(raw_markdown)

        # Renumber images to be globally unique across pages
        if bboxes:
            renumbered_bboxes: dict[str, list[int]] = {}
            md_with_renumbered = cleaned_md

            for old_name, coords in bboxes.items():
                image_counter += 1
                new_name = f"image_{image_counter}.png"
                renumbered_bboxes[new_name] = coords
                md_with_renumbered = md_with_renumbered.replace(
                    f"![image]({old_name})",
                    f"![image]({new_name})"
                )

            cleaned_md = md_with_renumbered

            # Extract actual images from PDF
            extracted = extract_images_from_pdf(pdf_path, page_idx, renumbered_bboxes)
            all_images.update(extracted)

        markdown_parts.append(cleaned_md)

    # Combine all pages
    markdown_content = "\n\n---\n\n".join(markdown_parts)
    html_content = markdown_to_html(markdown_content)

    return {
        "content": html_content,
        "metadata": {"page_count": len(pages), "processor": "lightonocr"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "json": None,
            "chunks": None,  # To be implemented later
        },
        "images": all_images if all_images else None,
    }


def _convert_image(image_path: Path) -> dict:
    """Convert a single image file."""
    # Load and resize image
    img = Image.open(image_path)
    img = resize_image_for_inference(img)

    # Run OCR inference
    image_b64 = pil_to_base64(img)
    raw_markdown = run_inference(image_b64)

    # Parse bbox annotations
    # Note: For single images, we can't extract embedded images since there's no PDF
    # The bboxes would point to regions in the original image
    cleaned_md, bboxes = parse_bbox_from_markdown(raw_markdown)

    # For images, we could optionally crop from the source image
    # but for now we'll just include the cleaned markdown
    all_images: dict[str, str] = {}
    if bboxes:
        # Renumber and extract from the source image
        image_counter = 0
        for old_name, coords in bboxes.items():
            image_counter += 1
            new_name = f"image_{image_counter}.png"
            cleaned_md = cleaned_md.replace(
                f"![image]({old_name})",
                f"![image]({new_name})"
            )

            # Extract region from source image
            x1 = int(coords[0] / 1000 * img.width)
            y1 = int(coords[1] / 1000 * img.height)
            x2 = int(coords[2] / 1000 * img.width)
            y2 = int(coords[3] / 1000 * img.height)

            x1, x2 = min(x1, x2), max(x1, x2)
            y1, y2 = min(y1, y2), max(y1, y2)

            if x2 - x1 > 0 and y2 - y1 > 0:
                crop = img.crop((x1, y1, x2, y2))
                all_images[new_name] = pil_to_base64(crop)

    html_content = markdown_to_html(cleaned_md)

    return {
        "content": html_content,
        "metadata": {"page_count": 1, "processor": "lightonocr"},
        "formats": {
            "html": html_content,
            "markdown": cleaned_md,
            "json": None,
            "chunks": None,
        },
        "images": all_images if all_images else None,
    }
