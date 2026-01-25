#!/bin/bash
set -e

echo "[entrypoint] Starting vLLM server for LightOnOCR..."
vllm serve lightonai/LightOnOCR-2-1B-bbox-soup \
    --dtype bfloat16 \
    --max-model-len 8192 \
    --limit-mm-per-prompt '{"image": 1}' \
    --gpu-memory-utilization 0.9 \
    --served-model-name lightonocr \
    --mm-processor-cache-gb 0 \
    --port 8000 \
    &

VLLM_PID=$!

echo "[entrypoint] Waiting for vLLM server to be ready..."
until curl -sf http://localhost:8000/v1/models > /dev/null 2>&1; do
    if ! kill -0 $VLLM_PID 2>/dev/null; then
        echo "[entrypoint] vLLM server died unexpectedly"
        exit 1
    fi
    sleep 2
done

echo "[entrypoint] vLLM server ready!"

# Mode-dependent: runpod handler vs local FastAPI
if [ "$MODE" = "local" ]; then
    echo "[entrypoint] Starting FastAPI server (local mode)..."
    exec python -u -m uvicorn app.main:app --host 0.0.0.0 --port 8001
else
    echo "[entrypoint] Starting runpod handler..."
    exec python -u -m app.handler
fi
