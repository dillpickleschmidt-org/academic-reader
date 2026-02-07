# PyTorch base image - PyTorch 2.8, Python 3.11
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install espeak-ng (required by kokoro's G2P engine misaki)
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Kokoro model and voice files during build
RUN python -c "\
from kokoro import KPipeline; \
print('Downloading Kokoro model and voices...'); \
p = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M'); \
p.load_voice('af_heart'); \
p.load_voice('af_bella'); \
print('Kokoro model and voices cached successfully')"

# Copy application code
COPY core/ ./core/
COPY app/ ./app/

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
