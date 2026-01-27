# Runpod PyTorch base image with CUDA support
FROM runpod/pytorch:1.0.3-cu1290-torch291-ubuntu2204

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies (--ignore-installed for blinker conflict)
RUN pip install --no-cache-dir --ignore-installed -r requirements.txt

COPY app/ ./app/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Download model during build (for vLLM server)
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('datalab-to/chandra')"

# vLLM server port only (no FastAPI for runpod-only mode)
EXPOSE 8000

# Use entrypoint script to manage vLLM server + handler
CMD ["./entrypoint.sh"]
