#!/bin/bash
set -e

# Avoid CPU contention during preprocessing
export OMP_NUM_THREADS=1

echo "[entrypoint] Starting vLLM server..."
vllm serve datalab-to/chandra \
    --dtype bfloat16 \
    --max-model-len 32768 \
    --max-num-seqs 32 \
    --max-num-batched-tokens 65536 \
    --gpu-memory-utilization 0.9 \
    --no-enforce-eager \
    --served-model-name chandra \
    --limit-mm-per-prompt.video 0 \
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

echo "[entrypoint] vLLM server ready, starting handler..."
exec python -u -m app.handler
