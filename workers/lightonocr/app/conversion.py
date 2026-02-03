"""LightOnOCR conversion logic."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING

from PIL import Image

from .markdown_utils import (
    crop_bbox_regions,
    pil_to_base64,
    resize_image_for_inference,
    parse_bbox_from_markdown,
    extract_images_from_pdf,
    markdown_to_html,
    parse_page_range,
)

if TYPE_CHECKING:
    from vllm import LLM


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tiff", ".tif", ".bmp"}

BATCH_CONCURRENCY = 8


def convert_file(file_path: Path, page_range: str | None = None) -> dict:
    """Convert PDF or image file using LightOnOCR via HTTP API."""
    from .vllm_client import run_inference

    def batch_fn(images: list[str]) -> list[str]:
        with ThreadPoolExecutor(max_workers=BATCH_CONCURRENCY) as pool:
            return list(pool.map(run_inference, images))

    return _convert_file_internal(file_path, page_range, batch_fn)


def convert_image(file_path: Path) -> dict:
    """Convert a single image file using LightOnOCR via HTTP API."""
    from .vllm_client import run_inference

    return _convert_image(file_path, run_inference)


def convert_file_with_llm(
    file_path: Path,
    llm: "LLM",
    page_range: str | None = None,
) -> dict:
    """
    Convert PDF or image file using a direct vLLM LLM instance.

    Used by Modal worker where LLM is loaded as a class attribute.
    """
    def batch_fn(images: list[str]) -> list[str]:
        return _run_batch_inference_with_llm(llm, images)

    return _convert_file_internal(file_path, page_range, batch_fn)


def _run_batch_inference_with_llm(llm: "LLM", images_base64: list[str]) -> list[str]:
    """Run batched inference using direct vLLM LLM instance."""
    from vllm import SamplingParams

    conversations = [
        [{
            "role": "user",
            "content": [{
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{img}"}
            }]
        }]
        for img in images_base64
    ]

    outputs = llm.chat(
        messages=conversations,
        sampling_params=SamplingParams(
            max_tokens=4096,
            temperature=0.2,
            top_p=0.9,
        ),
    )
    return [out.outputs[0].text for out in outputs]


def _convert_file_internal(
    file_path: Path,
    page_range: str | None,
    batch_inference_fn,
) -> dict:
    """Internal conversion function that accepts a batch inference function."""
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        return _convert_pdf(file_path, page_range, batch_inference_fn)
    elif suffix in IMAGE_EXTENSIONS:
        inference_fn = lambda img: batch_inference_fn([img])[0]
        return _convert_image(file_path, inference_fn)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")


def _convert_pdf(pdf_path: Path, page_range: str | None, batch_inference_fn) -> dict:
    """Convert a PDF file with batched inference."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    total_pages = len(pdf)
    pages = parse_page_range(page_range, total_pages)

    # Render all pages once (reused for both inference and image extraction)
    rendered_pages: dict[int, Image.Image] = {}
    page_images_b64: list[str] = []
    for page_idx in pages:
        bitmap = pdf[page_idx].render(scale=2.0)
        rendered = bitmap.to_pil()
        rendered_pages[page_idx] = rendered
        resized = resize_image_for_inference(rendered)
        page_images_b64.append(pil_to_base64(resized))

    pdf.close()

    # Batch inference — all pages at once
    raw_markdowns = batch_inference_fn(page_images_b64)

    # Post-process sequentially (image renumbering needs global counter)
    markdown_parts: list[str] = []
    all_images: dict[str, str] = {}
    image_counter = 0

    for page_idx, raw_markdown in zip(pages, raw_markdowns):
        # Parse bbox annotations and extract images
        cleaned_md, bboxes = parse_bbox_from_markdown(raw_markdown)

        # Renumber images to be globally unique across pages
        if bboxes:
            renumbered_bboxes: dict[str, list[int]] = {}
            md_with_renumbered = cleaned_md

            for old_name, coords in bboxes.items():
                image_counter += 1
                new_name = f"image_{image_counter}.png"
                renumbered_bboxes[new_name] = coords
                md_with_renumbered = md_with_renumbered.replace(
                    f"![image]({old_name})",
                    f"![image]({new_name})"
                )

            cleaned_md = md_with_renumbered

            # Extract actual images using already-rendered page
            extracted = extract_images_from_pdf(
                pdf_path, page_idx, renumbered_bboxes,
                rendered_page=rendered_pages[page_idx],
            )
            all_images.update(extracted)

        markdown_parts.append(cleaned_md)

    # Free rendered pages after extraction
    rendered_pages.clear()

    # Combine all pages
    markdown_content = "\n\n---\n\n".join(markdown_parts)
    html_content = markdown_to_html(markdown_content)

    return {
        "content": html_content,
        "metadata": {"page_count": len(pages), "processor": "lightonocr"},
        "formats": {
            "html": html_content,
            "markdown": markdown_content,
            "chunks": None,
        },
        "images": all_images if all_images else None,
    }


def _convert_image(image_path: Path, inference_fn) -> dict:
    """Convert a single image file."""
    # Load and resize image
    img = Image.open(image_path)
    img = resize_image_for_inference(img)

    # Run OCR inference
    image_b64 = pil_to_base64(img)
    raw_markdown = inference_fn(image_b64)

    # Parse bbox annotations
    # Note: For single images, we can't extract embedded images since there's no PDF
    # The bboxes would point to regions in the original image
    cleaned_md, bboxes = parse_bbox_from_markdown(raw_markdown)

    all_images: dict[str, str] = {}
    if bboxes:
        # Renumber and extract from the source image
        renumbered_bboxes: dict[str, list[int]] = {}
        image_counter = 0
        for old_name, coords in bboxes.items():
            image_counter += 1
            new_name = f"image_{image_counter}.png"
            renumbered_bboxes[new_name] = coords
            cleaned_md = cleaned_md.replace(
                f"![image]({old_name})",
                f"![image]({new_name})"
            )

        all_images = crop_bbox_regions(img, renumbered_bboxes)

    html_content = markdown_to_html(cleaned_md)

    return {
        "content": html_content,
        "metadata": {"page_count": 1, "processor": "lightonocr"},
        "formats": {
            "html": html_content,
            "markdown": cleaned_md,
            "chunks": None,
        },
        "images": all_images if all_images else None,
    }
