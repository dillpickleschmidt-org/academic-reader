from pathlib import Path

from .html_processing import embed_images_as_base64, enhance_html_for_reader, inject_image_dimensions
from .jobs import update_job
from .models import get_or_create_models
from .progress import clear_queue, set_active_job


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
    # Set this job as active for progress tracking
    set_active_job(job_id)

    try:
        update_job(job_id, status="processing")

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
        converter = PdfConverter(
            config=config_parser.generate_config_dict(),
            artifact_dict=get_or_create_models(),
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer(),
        )

        result = converter(str(file_path))

        if output_format == "html":
            # Phase 1: HTML without embedded images
            html_content = result.html
            html_content = enhance_html_for_reader(html_content)

            # Inject image dimensions for shimmer placeholders (prevents layout shift)
            images = getattr(result, "images", None) or {}
            if images:
                html_content = inject_image_dimensions(html_content, images)

            # Signal that HTML is ready (without images)
            update_job(job_id, status="html_ready", html_content=html_content)

            # Phase 2: Embed images (if any)
            if images:
                content = embed_images_as_base64(html_content, images)
            else:
                content = html_content

        elif output_format == "json":
            content = result.model_dump_json()
        else:
            content = result.markdown

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
