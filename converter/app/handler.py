"""Runpod Serverless handler."""

import tempfile
from pathlib import Path

import httpx
import runpod

from .progress import install_webhook_tqdm_patch, set_webhook_callback

# Install webhook tqdm patch before any marker imports
install_webhook_tqdm_patch()

from .conversion import run_conversion_sync


def handler(job: dict) -> dict:
    """
    Handler for Runpod Serverless.

    Input:
        file_url: URL to download the file from
        output_format: "html" | "markdown" | "json" (default: "html")
        use_llm: bool (default: False)
        page_range: str | None (default: None)
        progress_webhook_url: str | None - URL to POST progress updates to

    Returns:
        content: The converted document
        metadata: Document metadata
    """
    job_input = job["input"]
    job_id = job["id"]

    file_url = job_input.get("file_url")
    if not file_url:
        return {"error": "Missing required field: file_url"}

    output_format = job_input.get("output_format", "html")
    use_llm = job_input.get("use_llm", False)
    page_range = job_input.get("page_range")
    progress_webhook_url = job_input.get("progress_webhook_url")

    # Set up progress webhook callback if URL provided
    if progress_webhook_url:
        def send_progress(stage: str, current: int, total: int):
            try:
                httpx.post(
                    progress_webhook_url,
                    json={
                        "job_id": job_id,
                        "stage": stage,
                        "current": current,
                        "total": total,
                    },
                    timeout=5.0,
                )
            except Exception:
                pass  # Don't fail job on progress webhook errors

        set_webhook_callback(send_progress)
    else:
        set_webhook_callback(None)

    # Extract file extension from URL
    url_path = file_url.split("?")[0]  # Remove query params
    suffix = Path(url_path).suffix or ".pdf"

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
        result = run_conversion_sync(
            file_path=temp_path,
            output_format=output_format,
            use_llm=use_llm,
            page_range=page_range,
        )
        return result
    except Exception as e:
        return {"error": f"Conversion failed: {e}"}
    finally:
        temp_path.unlink(missing_ok=True)
        set_webhook_callback(None)  # Clear callback


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
