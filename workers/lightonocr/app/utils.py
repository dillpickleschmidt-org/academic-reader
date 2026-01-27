"""Shared utilities for LightOnOCR worker."""
from pathlib import Path

MIME_TO_EXT = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/tiff": ".tiff",
    "image/bmp": ".bmp",
}


def get_suffix(mime_type: str | None, file_url: str) -> str:
    """Get file extension from mime_type, falling back to URL parsing."""
    if mime_type and mime_type in MIME_TO_EXT:
        return MIME_TO_EXT[mime_type]
    url_path = file_url.split("?")[0]
    return Path(url_path).suffix.lower() or ".pdf"
