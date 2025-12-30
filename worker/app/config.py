"""Centralized configuration and constants."""

import tempfile
from pathlib import Path

# File storage
UPLOAD_DIR = Path(tempfile.gettempdir()) / "academic-reader-uploads"

# CORS
CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"]

# Supported file types
SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".docx",
    ".doc",
    ".odt",
    ".xlsx",
    ".xls",
    ".ods",
    ".pptx",
    ".ppt",
    ".odp",
    ".html",
    ".epub",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".tiff",
}
