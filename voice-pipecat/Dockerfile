FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libopus0: runtime del códec Opus que usa sphn (full-duplex Moshi). libgomp1:
# onnxruntime del VAD silero (modo pipeline). ca-certificates: TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libopus0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Web service: Telnyx necesita una URL pública HTTPS/WSS que apunte aquí.
# Render inyecta $PORT.
CMD ["sh", "-c", "uvicorn bot:app --host 0.0.0.0 --port ${PORT:-8080}"]
