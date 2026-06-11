"""Shared Modal conversion transport for document OCR workers."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Any
import json
import tempfile
import time

import httpx

ConversionFn = Callable[[Path], dict[str, Any]]


def run_conversion_job(
    *,
    worker: str,
    file_url: str,
    result_upload_url: str,
    request_id: str,
    document_id: str,
    user_id: str,
    page_range: str | None,
    convert: ConversionFn,
    path: str,
    error_code: str,
    extra_fields: dict[str, Any] | None = None,
    result_fields: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, bool]:
    """Download an input file, run a worker Adapter, and upload JSON result."""
    start = time.perf_counter()
    extra_fields = extra_fields or {}
    suffix = Path(file_url.split("?")[0]).suffix or ".pdf"

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as temp_file:
            response = httpx.get(file_url, follow_redirects=True, timeout=60.0)
            response.raise_for_status()
            temp_file.write(response.content)
            temp_file.flush()
            result = convert(Path(temp_file.name))

        chunks = (result.get("formats") or {}).get("chunks") or {}
        httpx.put(result_upload_url, json=result, timeout=120.0).raise_for_status()
        log_event(
            worker=worker,
            eventName="conversion_complete",
            requestId=request_id,
            documentId=document_id,
            userId=user_id,
            method="BACKGROUND",
            path=path,
            status=200,
            durationMs=round((time.perf_counter() - start) * 1000),
            pageRange=page_range,
            chunkCount=len(chunks.get("blocks") or []),
            imageCount=len(result.get("images") or {}),
            **extra_fields,
            **(result_fields(result) if result_fields else {}),
        )
        return {"s3_result": True}
    except Exception as error:
        log_event(
            worker=worker,
            eventName="conversion_failed",
            requestId=request_id,
            documentId=document_id,
            userId=user_id,
            method="BACKGROUND",
            path=path,
            status=500,
            durationMs=round((time.perf_counter() - start) * 1000),
            pageRange=page_range,
            errorCategory="internal",
            errorMessage=str(error),
            errorCode=error_code,
            **extra_fields,
        )
        raise


def log_event(worker: str, **fields: Any) -> None:
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "academic-reader-worker",
        "worker": worker,
        **fields,
    }
    print(
        json.dumps({key: value for key, value in event.items() if value is not None}, default=str),
        flush=True,
    )


async def modal_status(call_id: str) -> dict[str, Any]:
    import modal

    function_call = modal.FunctionCall.from_id(call_id)
    try:
        output = await function_call.get.aio(timeout=0)
        return {"status": "COMPLETED", "output": output}
    except modal.exception.OutputExpiredError:
        return {"status": "FAILED", "error": "expired"}
    except TimeoutError:
        return {"status": "IN_PROGRESS"}
    except Exception as error:
        return {"status": "FAILED", "error": str(error)}
