# PyTorch base image - PyTorch 2.8, Python 3.11
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install espeak-ng (required by kokoro's G2P engine misaki)
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY workers/kokoro-tts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/api-client/src/tts-manifest.json ./tts-manifest.json
COPY workers/tts_manifest.py ./tts_manifest.py

# Pre-download Kokoro model and voice files during build
RUN python -c "\
from kokoro import KPipeline; \
from tts_manifest import voices_for_engine; \
print('Downloading Kokoro model and voices...'); \
p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M'); \
[p.load_voice(v['kokoro']['voice']) for v in voices_for_engine('kokoro')]; \
print('Kokoro model and voices cached successfully')"

# Copy application code
COPY workers/kokoro-tts/core/ ./core/
COPY workers/kokoro-tts/app/ ./app/

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
