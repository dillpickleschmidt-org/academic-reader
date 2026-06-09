"""Conversion logic adapted for multiprocessing.

This module is the entry point for subprocess-based conversion.
It handles shared state updates.
"""

import traceback
from pathlib import Path


def _update_shared_job(jobs_dict: dict, job_id: str, **updates) -> None:
    """Update a job in the shared Manager dict."""
    if job_id in jobs_dict:
        current = dict(jobs_dict[job_id])
        current.update(updates)
        jobs_dict[job_id] = current


def run_conversion_process(
    job_id: str,
    file_path: Path,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
    jobs_dict: dict,  # Manager.dict()
) -> None:
    """Run conversion in a subprocess with IPC.

    This is the subprocess entry point. It runs the conversion and updates shared job state.
    """
    try:
        _update_shared_job(jobs_dict, job_id, status="processing")

        from .conversion import _build_and_render_all, _process_html
        from .html_processing import images_to_base64

        all_formats = _build_and_render_all(file_path, use_llm, force_ocr, page_range)

        # Process HTML (inject image dimensions) - no base64 embedding
        # Server will upload images to bucket and rewrite URLs
        html_content, images = _process_html(all_formats["html"], all_formats["images"])

        _update_shared_job(
            jobs_dict,
            job_id,
            status="completed",
            result={
                "content": html_content,
                "metadata": all_formats["metadata"],
                "formats": {
                    "html": html_content,
                    "markdown": all_formats["markdown"],
                    "chunks": all_formats["chunks"],
                },
                "images": images_to_base64(images) if images else None,
            },
        )
    except FileNotFoundError:
        _update_shared_job(jobs_dict, job_id, status="failed", error="File not found")
    except ValueError as e:
        _update_shared_job(jobs_dict, job_id, status="failed", error=f"Invalid input: {e}")
    except Exception as e:
        traceback.print_exc()
        _update_shared_job(jobs_dict, job_id, status="failed", error=f"Conversion failed: {e}")
    finally:
        # Cleanup uploaded file
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
