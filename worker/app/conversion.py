import time
from pathlib import Path

from .html_processing import embed_images_as_base64, enhance_html_for_reader, inject_image_dimensions
from .jobs import update_job
from .models import get_or_create_models


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
    try:
        update_job(job_id, status="processing")
        total_start = time.time()

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
        print(f"[conversion] Converter setup in {time.time() - total_start:.1f}s", flush=True)

        convert_start = time.time()
        result = converter(str(file_path))
        print(f"[conversion] Marker finished in {time.time() - convert_start:.1f}s", flush=True)

        if output_format == "html":
            # Phase 1: HTML without embedded images
            html_content = result.html
            html_content = enhance_html_for_reader(html_content)

            # Inject image dimensions for shimmer placeholders (prevents layout shift)
            images = result.images if hasattr(result, "images") else {}
            if images:
                html_content = inject_image_dimensions(html_content, images)

            # Signal that HTML is ready (without images)
            update_job(job_id, status="html_ready", html_content=html_content)

            # Phase 2: Embed images (if any)
            image_count = len(result.images) if hasattr(result, "images") and result.images else 0
            print(f"[conversion] html_ready sent, {image_count} images to embed", flush=True)
            if image_count > 0:
                import time as _time
                _time.sleep(10)  # TODO: Remove - temporary delay to test shimmer
                content = embed_images_as_base64(html_content, result.images)
            else:
                content = html_content

        elif output_format == "json":
            content = result.model_dump_json()
        else:
            content = result.markdown

        print(f"[conversion] Total time: {time.time() - total_start:.1f}s", flush=True)
        update_job(
            job_id,
            status="completed",
            result={
                "content": content,
                "metadata": result.metadata,
            },
        )
    except Exception as e:
        update_job(job_id, status="failed", error=str(e))
    finally:
        if file_path.exists():
            file_path.unlink()
