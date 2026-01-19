# Runpod PyTorch base image - PyTorch 2.8 pre-installed
# CUDA 12.8 requires driver 570+ (newer drivers)
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock .

# Install pinned dependencies (PyTorch already in base image - pip will skip it)
RUN pip install --no-cache-dir -r requirements.lock

COPY app/ ./app/

# Download and cache marker models during build
RUN python -c "from marker.models import create_model_dict; create_model_dict()"

# Pre-download font for offline operation
RUN python -c "\
import os, urllib.request; \
from marker.settings import settings; \
os.makedirs(settings.FONT_DIR, exist_ok=True); \
font_url = f'{settings.ARTIFACT_URL}/{settings.FONT_NAME}'; \
font_path = os.path.join(settings.FONT_DIR, settings.FONT_NAME); \
print(f'Downloading {font_url}'); \
urllib.request.urlretrieve(font_url, font_path); \
print(f'Saved to {font_path}')"

EXPOSE 8000

# Default to Runpod serverless handler
# Local dev: docker-compose overrides with "uvicorn app.main:app ..."
CMD ["python", "-u", "-m", "app.handler"]
