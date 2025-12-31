from pathlib import Path
from typing import Any

from .html_processing import embed_images_as_base64, inject_image_dimensions
from .jobs import update_job
from .models import get_or_create_models
from .progress import clear_queue, set_active_job


def _create_converter(
    output_format: str,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
):
    """Create a configured PDF converter."""
    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter

    config_dict = {
        "output_format": output_format,
        "use_llm": use_llm,
        "force_ocr": force_ocr,
    }
    if page_range:
        config_dict["page_range"] = page_range

    config_parser = ConfigParser(config_dict)
    return PdfConverter(
        config=config_parser.generate_config_dict(),
        artifact_dict=get_or_create_models(),
        processor_list=config_parser.get_processors(),
        renderer=config_parser.get_renderer(),
    )


def _process_result(result: Any, output_format: str, embed_images: bool = True) -> tuple[str, dict | None]:
    """Process converter result into final content.

    Returns:
        Tuple of (content, images_dict or None)
        images_dict is returned only for HTML when embed_images=False
    """
    if output_format == "html":
        content = result.html
        images = getattr(result, "images", None) or {}

        if images:
            content = inject_image_dimensions(content, images)
            if embed_images:
                content = embed_images_as_base64(content, images)
                return content, None
            return content, images
        return content, None

    if output_format == "json":
        return result.model_dump_json(), None

    return result.markdown, None


def run_conversion_sync(
    file_path: Path,
    output_format: str,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
) -> dict:
    """Synchronous conversion without job tracking. Used by serverless handler."""
    converter = _create_converter(output_format, use_llm, force_ocr, page_range)
    result = converter(str(file_path))
    content, _ = _process_result(result, output_format, embed_images=True)

    return {
        "content": content,
        "metadata": result.metadata,
    }


def run_conversion(
    job_id: str,
    file_path: Path,
    output_format: str,
    use_llm: bool,
    force_ocr: bool,
    page_range: str | None,
) -> None:
    """Run the document conversion in a background thread.

    For HTML output, this uses two phases:
    1. html_ready - HTML without embedded images (fast)
    2. completed - HTML with embedded images (final)
    """
    set_active_job(job_id)

    try:
        update_job(job_id, status="processing")

        converter = _create_converter(output_format, use_llm, force_ocr, page_range)
        result = converter(str(file_path))

        if output_format == "html":
            # Phase 1: HTML without embedded images
            html_content, images = _process_result(result, output_format, embed_images=False)
            update_job(job_id, status="html_ready", html_content=html_content)

            # Phase 2: Embed images (if any)
            if images:
                content = embed_images_as_base64(html_content, images)
            else:
                content = html_content
        else:
            content, _ = _process_result(result, output_format)

        update_job(
            job_id,
            status="completed",
            result={
                "content": content,
                "metadata": result.metadata,
            },
        )
    except FileNotFoundError:
        update_job(job_id, status="failed", error="File not found")
    except ValueError as e:
        update_job(job_id, status="failed", error=f"Invalid input: {e}")
    except Exception:
        update_job(job_id, status="failed", error="Conversion failed unexpectedly")
    finally:
        set_active_job(None)
        clear_queue(job_id)
        if file_path.exists():
            file_path.unlink()
