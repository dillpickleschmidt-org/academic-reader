"""Conversion logic adapted for multiprocessing.

This module is the entry point for subprocess-based conversion.
It handles shared state updates and progress reporting via mp.Queue.
"""

import multiprocessing as mp
import traceback
from pathlib import Path
from typing import Any

from .progress import install_mp_tqdm_patch


def _update_shared_job(jobs_dict: dict, job_id: str, **updates) -> None:
    """Update a job in the shared Manager dict."""
    if job_id in jobs_dict:
        current = dict(jobs_dict[job_id])
        current.update(updates)
        jobs_dict[job_id] = current


def run_conversion_process(
    job_id: str,
    file_path: Path,
    output_format: str,
    use_llm: bool,
    page_range: str | None,
    jobs_dict: dict,  # Manager.dict()
    progress_queue: mp.Queue,
) -> None:
    """Run conversion in a subprocess with IPC.

    This is the subprocess entry point. It:
    1. Installs the mp.Queue-based tqdm patch
    2. Runs the conversion
    3. Updates shared job state
    4. Reports progress via queue
    """
    # Install multiprocessing tqdm patch for this process
    install_mp_tqdm_patch(progress_queue)

    try:
        _update_shared_job(jobs_dict, job_id, status="processing")

        # Import here to ensure tqdm patch is installed first
        from .conversion import _build_and_render_all, _process_html
        from .html_processing import images_to_base64

        all_formats = _build_and_render_all(file_path, use_llm, page_range)

        # Process HTML (inject image dimensions) - no base64 embedding
        # Server will upload images to bucket and rewrite URLs
        html_content, images = _process_html(
            all_formats["html"], all_formats["images"], embed_images=False
        )
        _update_shared_job(jobs_dict, job_id, status="html_ready", html_content=html_content)

        # Return requested format as content
        if output_format == "html":
            content = html_content
        elif output_format == "json":
            content = all_formats["json"]
        elif output_format == "markdown":
            content = all_formats["markdown"]
        else:
            content = html_content

        _update_shared_job(
            jobs_dict,
            job_id,
            status="completed",
            result={
                "content": content,
                "metadata": all_formats["metadata"],
                "formats": {
                    "html": html_content,
                    "markdown": all_formats["markdown"],
                    "json": all_formats["json"],
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
