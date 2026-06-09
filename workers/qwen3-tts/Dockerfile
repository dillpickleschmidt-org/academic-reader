FROM vllm/vllm-openai:v0.22.0

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    libsndfile1 \
    sox \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf $(command -v python3) /usr/local/bin/python

COPY workers/qwen3-tts/requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY packages/api-client/src/tts-manifest.json ./tts-manifest.json
COPY workers/tts_manifest.py ./tts_manifest.py
COPY workers/qwen3-tts/qwen3_tts.yaml ./qwen3_tts.yaml
COPY workers/qwen3-tts/app/ ./app/
COPY workers/qwen3-tts/voices/ ./voices/

RUN python3 -c "\
from huggingface_hub import snapshot_download; \
print('Downloading Qwen3-TTS model...'); \
snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base'); \
print('Model downloaded successfully')"

EXPOSE 8002

ENTRYPOINT []
CMD ["python3", "-m", "app.main"]
