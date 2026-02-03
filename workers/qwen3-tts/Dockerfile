# PyTorch base image - PyTorch 2.8, Python 3.11
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    sox \
    && rm -rf /var/lib/apt/lists/*

# Install flash-attn for optimized attention
RUN pip install --no-cache-dir flash-attn --no-build-isolation

# Install nano-qwen3tts-vllm
RUN pip install --no-cache-dir git+https://github.com/Dillpickleschmidt/nano-qwen3tts-vllm.git

# Install remaining dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache Qwen3-TTS model during build
RUN python -c "\
from huggingface_hub import snapshot_download; \
print('Downloading model...'); \
snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base'); \
print('Model downloaded successfully')"

# Copy application code
COPY core/ ./core/
COPY app/ ./app/
COPY voices/ ./voices/

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
