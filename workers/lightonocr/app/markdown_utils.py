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

# Pre-compiled regex patterns
BBOX_PATTERN = re.compile(r'!\[image\]\((image_\d+\.png)\)\s*(\d+),(\d+),(\d+),(\d+)')
DISPLAY_MATH_PATTERN = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)
INLINE_MATH_PATTERN = re.compile(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)')


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
    bboxes: dict[str, list[int]] = {}

    def replace_match(m: re.Match) -> str:
        name = m.group(1)
        bboxes[name] = [int(m.group(i)) for i in range(2, 6)]
        return f'![image]({name})'  # Clean version without coords

    cleaned = BBOX_PATTERN.sub(replace_match, markdown_text)
    return cleaned, bboxes


def crop_bbox_regions(
    image: Image.Image,
    bboxes: dict[str, list[int]],
    padding: dict[str, int] | None = None,
) -> dict[str, str]:
    """
    Crop image regions using normalized [0,1000] coordinates.

    Args:
        image: Source image to crop from
        bboxes: {"image_1.png": [x1, y1, x2, y2], ...} with coords in [0,1000]
        padding: {"top": N, "bottom": N, "left": N, "right": N} in normalized [0,1000] space

    Returns:
        {"image_1.png": "base64_encoded_png", ...}
    """
    if not bboxes:
        return {}

    default_padding = {"top": 10, "bottom": 0, "left": 0, "right": 10}
    p = {**default_padding, **(padding or {})}

    images: dict[str, str] = {}
    for name, coords in bboxes.items():
        # Apply padding in normalized space, clamped to [0, 1000]
        nx1 = max(0, min(coords[0], coords[2]) - p["left"])
        ny1 = max(0, min(coords[1], coords[3]) - p["top"])
        nx2 = min(1000, max(coords[0], coords[2]) + p["right"])
        ny2 = min(1000, max(coords[1], coords[3]) + p["bottom"])

        # Convert from [0,1000] to pixel coordinates
        x1 = int(nx1 / 1000 * image.width)
        y1 = int(ny1 / 1000 * image.height)
        x2 = int(nx2 / 1000 * image.width)
        y2 = int(ny2 / 1000 * image.height)

        if x2 - x1 > 0 and y2 - y1 > 0:
            crop = image.crop((x1, y1, x2, y2))
            images[name] = pil_to_base64(crop)

    return images


def extract_images_from_pdf(
    pdf_path: str | Path,
    page_idx: int,
    bboxes: dict[str, list[int]],
    rendered_page: Image.Image | None = None,
) -> dict[str, str]:
    """Extract image regions from a PDF page."""
    if not bboxes:
        return {}

    pil_image = rendered_page if rendered_page is not None else render_pdf_page(pdf_path, page_idx, scale=2.0)
    return crop_bbox_regions(pil_image, bboxes)


def markdown_to_html(md_text: str) -> str:
    """
    Convert markdown to HTML, preserving LaTeX for KaTeX rendering.

    LaTeX delimiters ($...$, $$...$$) are extracted before markdown
    parsing to prevent mangling, then restored as <math> tags for
    server-side KaTeX rendering.
    """
    # Protect LaTeX from markdown parser by replacing with placeholders
    placeholders: dict[str, tuple[str, bool]] = {}
    counter = 0

    def make_replacer(is_display: bool):
        def replace_math(m: re.Match) -> str:
            nonlocal counter
            key = f"\x00MATH{counter}\x00"
            counter += 1
            placeholders[key] = (m.group(1), is_display)
            return key
        return replace_math

    # Extract $$...$$ (display) before $...$ (inline) to avoid partial matches
    protected = DISPLAY_MATH_PATTERN.sub(make_replacer(True), md_text)
    protected = INLINE_MATH_PATTERN.sub(make_replacer(False), protected)

    converter = md.Markdown(extensions=[
        'tables',
        'fenced_code',
    ])
    html = converter.convert(protected)

    # Restore LaTeX as <math> tags for server-side KaTeX rendering
    for key, (content, is_display) in placeholders.items():
        if is_display:
            html = html.replace(key, f'<math display="block">{content}</math>')
        else:
            html = html.replace(key, f'<math>{content}</math>')

    return html


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
