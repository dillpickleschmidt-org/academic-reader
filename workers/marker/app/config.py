"""Centralized configuration and constants."""

import os
import tempfile
from pathlib import Path

# File storage
UPLOAD_DIR = Path(tempfile.gettempdir()) / "academic-reader-uploads"

# CORS - use SITE_URL as the allowed origin
# If not set, defaults to localhost for development
_site_url = os.getenv("SITE_URL", "")
CORS_ORIGINS = [_site_url] if _site_url else ["http://localhost:5173"]

# Marker batch sizes - set MARKER_BATCH_SIZES=h100 for Runpod H100 optimization
BATCH_SIZE_OVERRIDES = {}
if os.getenv("MARKER_BATCH_SIZES") == "h100":
    BATCH_SIZE_OVERRIDES = {
        "layout_batch_size": 12,
        "detection_batch_size": 8,
        "table_rec_batch_size": 12,
        "ocr_error_batch_size": 12,
        "recognition_batch_size": 64,
        "equation_batch_size": 16,
        "pdftext_workers": 16,
        "detector_postprocessing_cpu_workers": 8,
    }

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
