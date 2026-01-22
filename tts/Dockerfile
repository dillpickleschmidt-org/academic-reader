# Runpod PyTorch base image - PyTorch 2.8, Python 3.11
# Chatterbox pins torch==2.6.0 but works with 2.8 (stable APIs only)
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install chatterbox without torch dependency pin
RUN pip install --no-cache-dir chatterbox-tts --no-deps

# Install chatterbox deps (minus torch/torchaudio) + web framework
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache Chatterbox models during build
# IMPORTANT: This must be BEFORE copying app code so app changes don't invalidate model cache
RUN python -c "\
from chatterbox.tts import ChatterboxTTS; \
import torch; \
device = 'cuda' if torch.cuda.is_available() else 'cpu'; \
print(f'Loading model on {device}...'); \
ChatterboxTTS.from_pretrained(device); \
print('Model cached successfully')"

# Pre-download MMS alignment model for word-level timestamps
RUN python -c "\
from torchaudio.pipelines import MMS_FA; \
print('Downloading MMS alignment model...'); \
MMS_FA.get_model(); \
print('MMS model cached successfully')"

COPY app/ ./app/
COPY voices/ ./voices/

EXPOSE 8001

# Default to Runpod serverless handler
# Local dev: docker-compose overrides with "uvicorn app.main:app ..."
CMD ["python", "-u", "-m", "app.handler"]
