FROM nvidia/cuda:12.8.0-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies (build-essential needed for flash-attn)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-dev \
    libsndfile1 \
    ffmpeg \
    sox \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --upgrade pip

# Install PyTorch (required for flash-attn build)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir flash-attn --no-build-isolation

# Pre-download models during build
RUN python3 -c "\
from huggingface_hub import snapshot_download; \
print('Caching model weights...'); \
snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base'); \
print('Model cached successfully')"

RUN python3 -c "\
from torchaudio.pipelines import MMS_FA; \
print('Downloading MMS alignment model...'); \
MMS_FA.get_model(); \
print('MMS model cached successfully')"

COPY core/ ./core/
COPY app/ ./app/
COPY voices/ ./voices/

EXPOSE 8002

CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
