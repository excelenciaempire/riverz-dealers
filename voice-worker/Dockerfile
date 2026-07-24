FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libgomp1: requerido por onnxruntime (silero VAD + turn-detector). ca-certificates: TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hornea los pesos de los modelos (VAD + turn-detector) en la imagen para que el
# arranque en frío no tenga que descargarlos.
RUN python agent.py download-files

# Background worker: se registra en LiveKit Cloud y espera dispatch/entrantes.
CMD ["python", "agent.py", "start"]
