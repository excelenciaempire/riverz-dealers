"""
Qwen-Omni voice server — spike para full-duplex español self-host en RunPod.

Sirve Qwen2.5-Omni-7B (speech-to-speech multilingüe) detrás de:
  - GET  /health                      → readiness
  - POST /v1/omni/turn                 → turn-based S2S (audio in → audio + texto out)
  - WS   /v1/omni/stream               → streaming turn-based (audio chunks → audio out)

Contrato pensado para que el voice-worker de Riverz (LiveKit) lo consuma vía un
adapter (ver README → "Integración"). Es turn-based (el cliente marca fin de
turno); el barge-in full-duplex real es el paso 2.

Modelo: Qwen/Qwen2.5-Omni-7B (Apache-2.0, habla español). ~24GB VRAM en fp16 →
entra en una RTX 4090/L40S. Config por env:
  MODEL_ID           (default Qwen/Qwen2.5-Omni-7B)
  OMNI_VOICE         voz del talker (default "Chelsie"; alt "Ethan")
  OMNI_AUTH_TOKEN    si está, exige Authorization: Bearer <token>
  MAX_NEW_TOKENS     (default 512)
"""
from __future__ import annotations

import base64
import io
import os
import time

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

MODEL_ID = os.getenv("MODEL_ID", "Qwen/Qwen2.5-Omni-7B")
OMNI_VOICE = os.getenv("OMNI_VOICE", "Chelsie")
AUTH_TOKEN = os.getenv("OMNI_AUTH_TOKEN", "")
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "512"))
OUT_SR = 24000  # Qwen2.5-Omni emite audio a 24 kHz
IN_SR = 16000   # esperamos PCM de entrada a 16 kHz

app = FastAPI(title="qwen-omni-voice")
_model = None
_processor = None


def _load():
    """Carga el modelo una sola vez (lazy → el /health responde durante el warmup)."""
    global _model, _processor
    if _model is not None:
        return
    from transformers import Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor

    _processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_ID)
    _model = Qwen2_5OmniForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation=os.getenv("ATTN_IMPL", "flash_attention_2"),
    )
    _model.eval()


def _check_auth(authorization: str | None) -> None:
    if AUTH_TOKEN and authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _pcm16_to_float(pcm_bytes: bytes) -> np.ndarray:
    """PCM16 LE mono → float32 [-1, 1]."""
    return np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0


def _wav_bytes(audio: np.ndarray, sr: int = OUT_SR) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@torch.inference_mode()
def _infer(system_prompt: str, audio_f32: np.ndarray, history: list | None = None):
    """Un turno: audio del usuario (+ system + historial) → (texto, audio 24kHz)."""
    _load()
    sys = system_prompt or (
        "Eres un asistente de voz de una tienda. Responde en español, natural y breve."
    )
    conversation = [
        {"role": "system", "content": [{"type": "text", "text": sys}]},
    ]
    if history:
        conversation.extend(history)
    conversation.append(
        {"role": "user", "content": [{"type": "audio", "audio": audio_f32}]}
    )

    text = _processor.apply_chat_template(
        conversation, add_generation_prompt=True, tokenize=False
    )
    inputs = _processor(
        text=text,
        audio=[audio_f32],
        sampling_rate=IN_SR,
        return_tensors="pt",
        padding=True,
    ).to(_model.device)

    text_ids, audio = _model.generate(
        **inputs,
        speaker=OMNI_VOICE,
        max_new_tokens=MAX_NEW_TOKENS,
        return_audio=True,
    )
    out_text = _processor.batch_decode(
        text_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )[0]
    audio_np = audio.reshape(-1).detach().cpu().numpy().astype(np.float32)
    return out_text, audio_np


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "loaded": _model is not None, "voice": OMNI_VOICE}


@app.post("/v1/omni/turn")
async def turn(body: dict, authorization: str | None = Header(default=None)):
    """Turn-based S2S. Body:
      { "system": str, "audio_b64": "<PCM16 16kHz base64>", "history": [...] }
    Devuelve: { "text": str, "audio_b64": "<WAV 24kHz base64>", "ms": int }
    """
    _check_auth(authorization)
    audio_b64 = body.get("audio_b64")
    if not audio_b64:
        raise HTTPException(status_code=400, detail="audio_b64 requerido")
    audio_f32 = _pcm16_to_float(base64.b64decode(audio_b64))
    t0 = time.time()
    text, audio_np = _infer(body.get("system", ""), audio_f32, body.get("history"))
    return JSONResponse(
        {
            "text": text,
            "audio_b64": base64.b64encode(_wav_bytes(audio_np)).decode(),
            "sample_rate": OUT_SR,
            "ms": int((time.time() - t0) * 1000),
        }
    )


@app.websocket("/v1/omni/stream")
async def stream(ws: WebSocket):
    """Streaming turn-based:
      1) primer mensaje JSON: {"system": str, "token": "<auth>"}
      2) frames binarios: PCM16 16kHz (el cliente acumula el turno del usuario)
      3) mensaje de texto "commit" → corre inferencia y responde:
           - JSON {"type":"text","text":...}
           - binario: WAV 24kHz
      Repetir 2-3 por turno. "close" termina.
    """
    await ws.accept()
    try:
        hello = await ws.receive_json()
        if AUTH_TOKEN and hello.get("token") != AUTH_TOKEN:
            await ws.close(code=4401)
            return
        system_prompt = hello.get("system", "")
        buf = bytearray()
        while True:
            msg = await ws.receive()
            if msg.get("bytes") is not None:
                buf.extend(msg["bytes"])
                continue
            data = msg.get("text") or ""
            if data == "commit":
                if not buf:
                    continue
                audio_f32 = _pcm16_to_float(bytes(buf))
                buf = bytearray()
                text, audio_np = _infer(system_prompt, audio_f32)
                await ws.send_json({"type": "text", "text": text})
                await ws.send_bytes(_wav_bytes(audio_np))
            elif data == "close":
                break
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn

    # Precarga opcional: OMNI_PRELOAD=1 baja pesos al arrancar (evita cold start
    # en la primera llamada; en un Pod dedicado conviene).
    if os.getenv("OMNI_PRELOAD") == "1":
        _load()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
