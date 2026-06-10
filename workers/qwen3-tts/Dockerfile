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
RUN TORCH_VERSION=$(python3 -c "import torch; print(torch.__version__.split('+')[0])") \
    && CUDA_VERSION=$(python3 -c "import torch; print('cu' + torch.version.cuda.replace('.', '') if torch.version.cuda else 'cpu')") \
    && python3 -m pip install --no-cache-dir --no-deps --index-url https://download.pytorch.org/whl/${CUDA_VERSION} torchaudio==${TORCH_VERSION}

COPY workers/qwen3-tts/qwen3_tts.yaml ./qwen3_tts.yaml
COPY workers/qwen3-tts/app/ ./app/
COPY workers/qwen3-tts/custom_voices/ ./custom_voices/

RUN python3 -c "\
from huggingface_hub import snapshot_download; \
print('Downloading Qwen3-TTS model...'); \
snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base'); \
print('Model downloaded successfully')"
RUN python3 -c "from torchaudio.pipelines import MMS_FA; print('Downloading MMS alignment model...'); MMS_FA.get_model(); print('MMS model cached successfully')"

EXPOSE 8002

ENTRYPOINT []
CMD ["python3", "-m", "app.main"]
