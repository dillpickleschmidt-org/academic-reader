"""Runpod Serverless handler for LightOnOCR."""
import tempfile
from pathlib import Path

import httpx
import runpod

from .conversion import convert_file
from .utils import get_suffix


def handler(job: dict) -> dict:
    """
    Runpod serverless handler.

    Expected input:
    {
        "file_url": "https://...",
        "mime_type": "application/pdf",  # optional but recommended
        "page_range": "1-5"  # optional
    }
    """
    job_input = job["input"]
    file_url = job_input.get("file_url")

    if not file_url:
        return {"error": "Missing required field: file_url"}

    page_range = job_input.get("page_range")  # Optional
    mime_type = job_input.get("mime_type")  # Optional
    suffix = get_suffix(mime_type, file_url)

    # Download file to temp location
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        try:
            with httpx.Client(follow_redirects=True, timeout=60.0) as client:
                response = client.get(file_url)
                response.raise_for_status()
                f.write(response.content)
        except httpx.HTTPError as e:
            return {"error": f"Failed to download file: {e}"}
        temp_path = Path(f.name)

    try:
        return convert_file(temp_path, page_range)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": f"Conversion failed: {e}"}
    finally:
        temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
