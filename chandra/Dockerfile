# Runpod PyTorch base image - matches Marker pattern
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies (PyTorch already in base image)
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Download and cache Chandra model during build
RUN python -c "from chandra.model import InferenceManager; InferenceManager(method='hf')"

# Default to Runpod serverless handler
CMD ["python", "-u", "-m", "app.handler"]
