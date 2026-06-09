"""HTML processing utilities for image handling."""
import base64
from io import BytesIO


def inject_image_dimensions(html: str, images: dict) -> str:
    """Add width/height attributes to img tags to prevent layout shift."""
    if not images:
        return html

    for image_name, pil_image in images.items():
        width, height = pil_image.width, pil_image.height
        # Add dimensions to img tags (both quote styles)
        html = html.replace(
            f"src='{image_name}'",
            f"src='{image_name}' width='{width}' height='{height}'",
        )
        html = html.replace(
            f'src="{image_name}"',
            f'src="{image_name}" width="{width}" height="{height}"',
        )

    return html


def _pil_to_base64(pil_image, jpeg_quality: int = 85) -> str:
    """Convert a single PIL image to base64 JPEG string."""
    buffer = BytesIO()
    # Convert to RGB if necessary (JPEG doesn't support RGBA)
    if pil_image.mode in ("RGBA", "P"):
        pil_image = pil_image.convert("RGB")
    pil_image.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def images_to_base64(images: dict, jpeg_quality: int = 85) -> dict[str, str]:
    """Convert PIL images dict to base64 strings dict."""
    if not images:
        return {}
    return {name: _pil_to_base64(img, jpeg_quality) for name, img in images.items()}
