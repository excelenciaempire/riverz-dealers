# Qwen-Omni voice server para RunPod (Pod dedicado o Serverless).
# Base con CUDA 12.1 + PyTorch (evita compilar torch). Imagen grande (~pesos se
# bajan en runtime o se hornean en un Network Volume — ver README).
FROM runpod/pytorch:2.4.0-py3.11-cuda12.1.1-devel-ubuntu22.04

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt hf_transfer

# flash-attn: acelera la inferencia (recomendado). Compila lento; si falla el
# build, comentá esta línea y seteá ATTN_IMPL=sdpa por env (más lento pero corre).
RUN pip install flash-attn --no-build-isolation || \
    echo "flash-attn no compiló; usá ATTN_IMPL=sdpa"

COPY server.py .

# El worker de Riverz habla al /health y /v1/omni/*. Puerto expuesto por RunPod.
ENV PORT=8000 OMNI_PRELOAD=0 ATTN_IMPL=flash_attention_2
EXPOSE 8000

CMD ["python", "server.py"]
