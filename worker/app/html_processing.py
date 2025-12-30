import base64
import re
from io import BytesIO

import latex2mathml.converter
from bs4 import BeautifulSoup, NavigableString


def _replace_image_src(html: str, old_src: str, new_src: str) -> str:
    """Replace image src attribute handling both quote styles."""
    return html.replace(f"src='{old_src}'", f"src='{new_src}'").replace(
        f'src="{old_src}"', f'src="{new_src}"'
    )


def inject_image_dimensions(html: str, images: dict) -> str:
    """Add width/height attributes to img tags to prevent layout shift."""
    if not images:
        return html

    for image_name, pil_image in images.items():
        width, height = pil_image.width, pil_image.height
        # Add dimensions to img tags (both quote styles)
        html = html.replace(
            f"src='{image_name}'",
            f"src='{image_name}' width='{width}' height='{height}'",
        )
        html = html.replace(
            f'src="{image_name}"',
            f'src="{image_name}" width="{width}" height="{height}"',
        )

    return html


def embed_images_as_base64(html: str, images: dict, jpeg_quality: int = 85) -> str:
    """Replace image src references with base64 data URLs."""
    if not images:
        return html

    for image_name, pil_image in images.items():
        buffer = BytesIO()
        # Convert to RGB if necessary (JPEG doesn't support RGBA)
        if pil_image.mode in ("RGBA", "P"):
            pil_image = pil_image.convert("RGB")
        pil_image.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
        b64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        # Replace src reference with data URL
        data_url = f"data:image/jpeg;base64,{b64_data}"
        html = _replace_image_src(html, image_name, data_url)

    return html


def enhance_html_for_reader(html: str) -> str:
    """Apply reader enhancements to HTML: citations, continuations, figure captions, etc."""
    soup = BeautifulSoup(html, "html.parser")

    # Citation pattern: [Author et al. Year], [Author Year], [Author and Author Year]
    citation_pattern = re.compile(
        r'\[([A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?'
        r'(?:\s+\d{4})?(?:;\s*[A-Z][a-zA-Zà-ÿ]+(?:\s+(?:et\s+al\.|and\s+[A-Z][a-zA-Zà-ÿ]+))?'
        r'(?:\s+\d{4})?)*)\]'
    )

    # Process text nodes to wrap citations
    for text_node in soup.find_all(string=True):
        if text_node.parent.name in ("script", "style"):
            continue
        text = str(text_node)
        if not citation_pattern.search(text):
            continue

        parts = []
        last_end = 0
        for match in citation_pattern.finditer(text):
            if match.start() > last_end:
                parts.append(NavigableString(text[last_end:match.start()]))
            span = soup.new_tag("span")
            span["class"] = "citation"
            span.string = match.group(0)
            parts.append(span)
            last_end = match.end()
        if last_end < len(text):
            parts.append(NavigableString(text[last_end:]))

        if parts:
            for i, part in enumerate(parts):
                if i == 0:
                    text_node.replace_with(part)
                else:
                    parts[i - 1].insert_after(part)

    # Find first h1 and remove junk before it
    h1 = soup.find("h1")
    if h1:
        for sibling in list(h1.previous_siblings):
            sibling.decompose()

        # Mark author/metadata paragraphs (short paragraphs between h1 and first h2)
        el = h1.find_next_sibling()
        while el and el.name not in ("h1", "h2"):
            if el.name == "p" and len(el.get_text(strip=True)) < 200:
                el["class"] = el.get("class", []) + ["author-meta"]
            el = el.find_next_sibling()

    # Mark figure captions and continuation paragraphs
    for p in soup.find_all("p"):
        text = " ".join(p.get_text().split()).strip()
        if re.match(r'^Fig\.\s*\d', text):
            p["class"] = p.get("class", []) + ["figure-caption"]
        elif text and text[0].islower():
            p["class"] = p.get("class", []) + ["continuation"]

    # Convert <math> tags to MathML with LaTeX fallback for KaTeX
    for math_el in soup.find_all("math"):
        latex = math_el.get_text(strip=True)
        if latex:
            try:
                mathml = latex2mathml.converter.convert(latex)
                # Wrap in container with data-latex for KaTeX progressive enhancement
                wrapper = soup.new_tag("span")
                wrapper["class"] = "math-render"
                wrapper["data-latex"] = latex
                mathml_soup = BeautifulSoup(mathml, "html.parser")
                wrapper.append(mathml_soup)
                math_el.replace_with(wrapper)
            except Exception as e:
                # Log failure but leave original
                print(f"[html] LaTeX conversion failed for: {latex[:50]}... - {e}", flush=True)

    return str(soup)
