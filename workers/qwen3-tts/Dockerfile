# PyTorch base image - PyTorch 2.8, Python 3.11
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies for audio processing (sox required for Qwen3-TTS)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    sox \
    && rm -rf /var/lib/apt/lists/*

# Install flash-attn for optimized attention (pre-built wheel for faster install)
RUN pip install --no-cache-dir flash-attn --no-build-isolation

# Install qwen-tts
RUN pip install --no-cache-dir qwen-tts

# Install remaining deps + web framework
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download and cache Qwen3-TTS model during build (CPU, no flash_attention_2)
# At runtime, model loads with flash_attention_2 when GPU is available
RUN python -c "\
import torch; \
from qwen_tts import Qwen3TTSModel; \
print('Caching model weights...'); \
Qwen3TTSModel.from_pretrained('Qwen/Qwen3-TTS-12Hz-1.7B-Base', device_map='cpu', dtype=torch.bfloat16); \
print('Model cached successfully')"

# Pre-download MMS alignment model for word-level timestamps
RUN python -c "\
from torchaudio.pipelines import MMS_FA; \
print('Downloading MMS alignment model...'); \
MMS_FA.get_model(); \
print('MMS model cached successfully')"

COPY app/ ./app/
COPY voices/ ./voices/

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
