#!/bin/bash
set -e

# Runpod-only: Start vLLM server then run handler
# CHANDRA requires ~19GB+ VRAM, so no local mode support

echo "[chandra] Starting vLLM server..."
vllm serve datalab-to/chandra \
    --dtype bfloat16 --max-model-len 8192 \
    --limit-mm-per-prompt '{"image": 1}' \
    --gpu-memory-utilization 0.9 \
    --served-model-name chandra \
    --mm-processor-cache-gb 0 --port 8000 &

echo "[chandra] Waiting for vLLM to be ready..."
until curl -sf http://localhost:8000/v1/models > /dev/null 2>&1; do sleep 2; done
echo "[chandra] vLLM ready, starting handler..."

exec python -u -m app.handler
