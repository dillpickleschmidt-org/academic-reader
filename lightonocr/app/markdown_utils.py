"""Utilities for parsing LightOnOCR output and converting markdown to HTML."""
import base64
import io
import re
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image
import markdown as md


# Maximum longest edge for input images (per LightOnOCR paper)
MAX_RESOLUTION = 1540


def pil_to_base64(img: Image.Image, format: str = "PNG") -> str:
    """Convert PIL Image to base64 string."""
    buffer = io.BytesIO()
    img.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def resize_image_for_inference(img: Image.Image) -> Image.Image:
    """Resize image so longest edge is at most MAX_RESOLUTION, preserving aspect ratio."""
    width, height = img.size
    longest = max(width, height)

    if longest <= MAX_RESOLUTION:
        return img

    scale = MAX_RESOLUTION / longest
    new_width = int(width * scale)
    new_height = int(height * scale)
    return img.resize((new_width, new_height), Image.Resampling.LANCZOS)


def render_pdf_page(pdf_path: str | Path, page_idx: int, scale: float = 2.0) -> Image.Image:
    """Render a PDF page to PIL Image."""
    pdf = pdfium.PdfDocument(str(pdf_path))
    page = pdf[page_idx]
    bitmap = page.render(scale=scale)
    pil_image = bitmap.to_pil()
    pdf.close()
    return pil_image


def get_pdf_page_count(pdf_path: str | Path) -> int:
    """Get total page count from PDF."""
    pdf = pdfium.PdfDocument(str(pdf_path))
    count = len(pdf)
    pdf.close()
    return count


def parse_bbox_from_markdown(markdown_text: str) -> tuple[str, dict[str, list[int]]]:
    """
    Parse LightOnOCR bbox notation from markdown.

    LightOnOCR outputs: ![image](image_N.png)x1,y1,x2,y2
    where coordinates are normalized to [0, 1000].

    Returns:
        tuple of (cleaned_markdown, bboxes_dict)
        - cleaned_markdown: markdown with bbox coords removed
        - bboxes_dict: {"image_1.png": [x1, y1, x2, y2], ...}
    """
    # Pattern: ![image](image_N.png)x1,y1,x2,y2
    # Note: there may or may not be a space between the image syntax and coords
    pattern = r'!\[image\]\((image_\d+\.png)\)\s*(\d+),(\d+),(\d+),(\d+)'
    bboxes: dict[str, list[int]] = {}

    def replace_match(m: re.Match) -> str:
        name = m.group(1)
        bboxes[name] = [int(m.group(i)) for i in range(2, 6)]
        return f'![image]({name})'  # Clean version without coords

    cleaned = re.sub(pattern, replace_match, markdown_text)
    return cleaned, bboxes


def extract_images_from_pdf(
    pdf_path: str | Path,
    page_idx: int,
    bboxes: dict[str, list[int]],
) -> dict[str, str]:
    """
    Extract image regions from PDF page using normalized [0,1000] coordinates.

    Args:
        pdf_path: Path to PDF file
        page_idx: 0-indexed page number
        bboxes: {"image_1.png": [x1, y1, x2, y2], ...} with coords in [0,1000]

    Returns:
        {"image_1.png": "base64_encoded_png", ...}
    """
    if not bboxes:
        return {}

    # Render page at high quality for cropping
    pil_image = render_pdf_page(pdf_path, page_idx, scale=2.0)

    images: dict[str, str] = {}
    for name, coords in bboxes.items():
        # Convert from [0,1000] to pixel coordinates
        x1 = int(coords[0] / 1000 * pil_image.width)
        y1 = int(coords[1] / 1000 * pil_image.height)
        x2 = int(coords[2] / 1000 * pil_image.width)
        y2 = int(coords[3] / 1000 * pil_image.height)

        # Ensure valid crop region
        x1, x2 = min(x1, x2), max(x1, x2)
        y1, y2 = min(y1, y2), max(y1, y2)

        if x2 - x1 > 0 and y2 - y1 > 0:
            crop = pil_image.crop((x1, y1, x2, y2))
            images[name] = pil_to_base64(crop)

    return images


def markdown_to_html(md_text: str) -> str:
    """
    Convert markdown to HTML, preserving LaTeX for KaTeX rendering.

    LaTeX delimiters ($...$, $$...$$) are passed through as-is
    for frontend rendering with KaTeX/MathJax.
    """
    # Configure markdown with common extensions
    converter = md.Markdown(extensions=[
        'tables',
        'fenced_code',
    ])
    return converter.convert(md_text)


def parse_page_range(page_range: str | None, total_pages: int) -> list[int]:
    """
    Parse page range string into list of 0-indexed page numbers.

    Supports formats like: "1-5", "1,3,5", "1-3,7-9", or None for all pages.
    Input uses 1-indexed pages (human readable), output is 0-indexed.
    """
    if not page_range:
        return list(range(total_pages))

    pages: set[int] = set()
    for part in page_range.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            start_idx = int(start) - 1
            end_idx = int(end) - 1
            for i in range(start_idx, min(end_idx + 1, total_pages)):
                if 0 <= i < total_pages:
                    pages.add(i)
        else:
            idx = int(part) - 1
            if 0 <= idx < total_pages:
                pages.add(idx)

    return sorted(pages)
