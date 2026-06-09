"""CHANDRA conversion logic using chandra-ocr SDK."""
import base64
import io
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from vllm import LLM

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}


def pil_to_base64(img) -> str:
    """Convert PIL Image to base64 WEBP string (matches chandra SDK format)."""
    buffer = io.BytesIO()
    img.save(buffer, format="WEBP")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def convert_file_with_llm(
    file_path: Path,
    llm: "LLM",
    page_range: str | None = None,
) -> dict:
    """
    Convert PDF or image file using a direct vLLM LLM instance.

    Used by Modal worker where LLM is loaded as a class attribute.
    """
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        return _convert_pdf_with_llm(file_path, page_range, llm)
    elif suffix in IMAGE_EXTENSIONS:
        return _convert_image_with_llm(file_path, llm)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


def _run_inference_with_llm(llm: "LLM", image, prompt: str) -> tuple[str, int]:
    """Run inference using Qwen3-VL prompt format. Returns (raw_text, token_count)."""
    from vllm import SamplingParams
    from chandra.model.util import scale_to_fit
    from chandra.settings import settings

    image = scale_to_fit(image)

    formatted_prompt = (
        "<|im_start|>user\n"
        "<|vision_start|><|image_pad|><|vision_end|>"
        f"{prompt}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )

    outputs = llm.generate(
        {"prompt": formatted_prompt, "multi_modal_data": {"image": image}},
        sampling_params=SamplingParams(
            temperature=0,
            top_p=0.1,
            max_tokens=settings.MAX_OUTPUT_TOKENS,
        ),
    )
    raw = outputs[0].outputs[0].text
    token_count = len(outputs[0].outputs[0].token_ids)
    return raw, token_count


def _convert_pdf_with_llm(pdf_path: Path, page_range: str | None, llm: "LLM") -> dict:
    """Convert a PDF file using direct vLLM LLM instance."""
    import pypdfium2 as pdfium
    from chandra.input import load_pdf_images, parse_range_str
    from chandra.output import parse_markdown, parse_html, parse_chunks, extract_images
    from chandra.prompts import PROMPT_MAPPING
    from chandra.settings import settings

    pdf = pdfium.PdfDocument(str(pdf_path))
    page_count = len(pdf)
    pdf.close()

    pages = parse_range_str(page_range) if page_range else list(range(page_count))
    pdf_images = load_pdf_images(str(pdf_path), page_range=pages)
    total_pages = len(pdf_images)

    prompt = PROMPT_MAPPING["ocr_layout"].replace("{bbox_scale}", str(settings.BBOX_SCALE))

    html_parts: list[str] = []
    markdown_parts: list[str] = []
    all_chunks: list[dict] = []
    all_images: dict[str, str] = {}
    failed_pages: list[int] = []

    for idx, img in enumerate(pdf_images):
        try:
            raw, token_count = _run_inference_with_llm(llm, img, prompt)

            html = parse_html(raw)
            markdown = parse_markdown(raw)
            chunks = parse_chunks(raw, img, bbox_scale=settings.BBOX_SCALE)
            images = extract_images(raw, chunks, img)

            if html:
                html_parts.append(html)
            if markdown:
                markdown_parts.append(markdown)

            if chunks:
                for chunk in chunks:
                    chunk_with_page = dict(chunk)
                    chunk_with_page["page"] = pages[idx]
                    all_chunks.append(chunk_with_page)

            if images:
                for name, extracted_img in images.items():
                    all_images[name] = pil_to_base64(extracted_img)

        except Exception:
            failed_pages.append(idx + 1)
            continue

    html_content = "\n<hr>\n".join(html_parts)
    markdown_content = "\n\n---\n\n".join(markdown_parts)

    return {
        "content": html_content,
        "metadata": {
            "page_count": total_pages,
            "processor": "chandra",
            "failed_pages": len(failed_pages),
        },
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "chunks": {"blocks": all_chunks} if all_chunks else None,
        },
        "images": all_images if all_images else None,
    }


def _convert_image_with_llm(image_path: Path, llm: "LLM") -> dict:
    """Convert a single image file using direct vLLM LLM instance."""
    from chandra.input import load_image
    from chandra.output import parse_markdown, parse_html, parse_chunks, extract_images
    from chandra.prompts import PROMPT_MAPPING
    from chandra.settings import settings

    img = load_image(str(image_path))
    prompt = PROMPT_MAPPING["ocr_layout"].replace("{bbox_scale}", str(settings.BBOX_SCALE))

    raw, token_count = _run_inference_with_llm(llm, img, prompt)

    html_content = parse_html(raw) or ""
    markdown_content = parse_markdown(raw) or ""
    chunks = parse_chunks(raw, img, bbox_scale=settings.BBOX_SCALE)
    images = extract_images(raw, chunks, img)

    chunk_list: list[dict] = []
    if chunks:
        for chunk in chunks:
            chunk_with_page = dict(chunk) if isinstance(chunk, dict) else {"content": str(chunk)}
            chunk_with_page["page"] = 1
            chunk_list.append(chunk_with_page)

    all_images: dict[str, str] = {}
    if images:
        for name, extracted_img in images.items():
            all_images[name] = pil_to_base64(extracted_img)

    return {
        "content": html_content,
        "metadata": {"page_count": 1, "processor": "chandra"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "chunks": {"blocks": chunk_list} if chunk_list else None,
        },
        "images": all_images if all_images else None,
    }
