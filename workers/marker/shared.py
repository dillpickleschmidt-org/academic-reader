"""Shared utilities for Marker workers (local and Modal)."""


def to_dict(obj):
    """Convert pydantic model to dict, or return as-is if already a dict."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return obj


def extract_chunks(document):
    """Extract chunks from a Marker document using ChunkRenderer."""
    try:
        from marker.renderers.chunk import ChunkRenderer
        chunk_output = ChunkRenderer()(document)
        if chunk_output:
            return {
                "blocks": [to_dict(b) for b in chunk_output.blocks],
            }
    except ImportError:
        pass
    return None


def encode_images(images: dict) -> dict[str, str]:
    """Convert PIL images to base64 strings."""
    import base64
    import io

    encoded = {}
    for name, img in images.items():
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        encoded[name] = base64.b64encode(buf.getvalue()).decode()
    return encoded
