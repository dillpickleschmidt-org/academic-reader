"""HTML processing utilities for image handling."""
import base64
from io import BytesIO


def _replace_image_src(html: str, old_src: str, new_src: str) -> str:
    """Replace image src attribute handling both quote styles."""
    return html.replace(f"src='{old_src}'", f"src='{new_src}'").replace(
        f'src="{old_src}"', f'src="{new_src}"'
    )


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


def embed_images_as_base64(html: str, images: dict, jpeg_quality: int = 85) -> str:
    """Replace image src references with base64 data URLs."""
    if not images:
        return html

    for image_name, pil_image in images.items():
        buffer = BytesIO()
        # Convert to RGB if necessary (JPEG doesn't support RGBA)
        if pil_image.mode in ("RGBA", "P"):
            pil_image = pil_image.convert("RGB")
        pil_image.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
        b64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        # Replace src reference with data URL
        data_url = f"data:image/jpeg;base64,{b64_data}"
        html = _replace_image_src(html, image_name, data_url)

    return html
