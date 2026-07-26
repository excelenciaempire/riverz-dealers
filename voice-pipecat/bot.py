"""Riverz Voice — worker Pipecat + Telnyx Media Streaming (SIN LiveKit).

Track PARALELO y experimental al worker de LiveKit (voice-worker/). No lo
reemplaza: comparte el MISMO contrato interno de Riverz (/api/internal/voice/*)
y la MISMA base de datos, así que las llamadas hechas por cualquiera de los dos
aparecen igual en la app.

Arquitectura (full-duplex, definitiva, sin LiveKit):

    PSTN ─ Telnyx (TeXML <Connect><Stream bidirectionalMode="rtp">) ─ /ws (este server)
         ─ Pipecat (FastAPIWebsocketTransport + TelnyxFrameSerializer)
         ─ MoshiBridge ─ PersonaPlex/Moshi (moshi.server WS en Modal)

También soporta el modo "pipeline" (Deepgram STT + Anthropic LLM + ElevenLabs
TTS) como alternativa, elegido por el campo `mode` del contexto de Riverz.

Endpoints:
  GET  /health                 sonda
  POST /dial      {call_id}    coloca una saliente vía Telnyx TeXML API
  *    /answer?call_id=...      devuelve el TeXML que arranca el streaming al /ws
  WS   /ws?call_id=...          media stream de Telnyx (entrante o saliente)

Verificado contra pipecat main + moshi.server (2026-07-25). Puntos sensibles a
la versión de pipecat están marcados con  # VERSION.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import suppress

import httpx
import uvicorn
from fastapi import FastAPI, Query, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.serializers.telnyx import TelnyxFrameSerializer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from moshi_bridge import MoshiBridge
from riverz_api import RiverzAPI

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("riverz-pipecat")

TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_ACCOUNT_SID = os.getenv("TELNYX_ACCOUNT_SID", "")
TELNYX_APPLICATION_SID = os.getenv("TELNYX_APPLICATION_SID", "")
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER", "")
# URL pública HTTPS de este servicio (Telnyx la usa para el TeXML y el WS).
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")

app = FastAPI(title="riverz-voice-pipecat")
api = RiverzAPI()


def _wss(path: str) -> str:
    base = PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://")
    return f"{base}{path}"


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True, "engine": "pipecat+telnyx"})


async def _el_pcm24(phrase: str) -> bytes:
    """ElevenLabs TTS -> raw PCM 24kHz int16 (for feeding moshi as 'speech')."""
    key = os.getenv("ELEVENLABS_API_KEY", "")
    if not key:
        return b""
    vid = "XrExE9yKIg1WjnnlVkGX"  # Matilda
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=pcm_24000"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            url,
            headers={"xi-api-key": key},
            json={"text": phrase, "model_id": "eleven_flash_v2_5"},
        )
        return r.content if r.status_code == 200 else b""


@app.get("/moshi-test")
async def moshi_test(
    url: str | None = Query(default=None),
    voice: str = Query(default="NATF2"),
    send: bool = Query(default=True),
    speak: bool = Query(default=False),
    text: str = Query(default="Hola, prueba."),
    chunk_ms: int = Query(default=80),
    via8k: bool = Query(default=False),
    bridgesim: bool = Query(default=False),
    secs: int = Query(default=12),
):
    """Debug (no phone call): connect the moshi client, optionally feed it silence,
    and log EVERY raw frame PersonaPlex returns (tag+len). Iterate the bridge safely."""
    import asyncio as _asyncio
    from moshi_client import MoshiClient

    import time as _t

    from pipecat.audio.utils import create_stream_resampler

    base = url or os.getenv("MOSHI_TEST_URL") or "wss://riverztest2--personaplex-serve.modal.run"
    client = MoshiClient(base, voice=voice, text_prompt=text)
    res: dict = {
        "handshake": False, "connect_ms": None, "text_len": len(text),
        "audio_msgs": 0, "decoded_bytes": 0, "resampled_bytes": 0,
        "text": [], "sent": 0, "error": None,
    }
    down = create_stream_resampler()  # 24k -> 8k, como el bridge real
    res["raw_audio_frames"] = 0
    res["input_pcm_bytes"] = 0
    try:
        _t0 = _t.monotonic()
        await client.connect()
        res["connect_ms"] = int((_t.monotonic() - _t0) * 1000)
        res["handshake"] = True

        # Lector inline: cuenta frames CRUDOS (tag 1) y decodifica (drena read_pcm)
        # para distinguir "moshi no manda audio" de "el decode falla".
        async def reader() -> None:
            async for m in client._ws:
                if not isinstance(m, (bytes, bytearray)) or not m:
                    continue
                tag, payload = m[0], m[1:]
                if tag == 1:
                    res["raw_audio_frames"] += 1
                    client._reader.append_bytes(payload)
                    while True:
                        pcm = client._reader.read_pcm()
                        if pcm is None or pcm.shape[-1] == 0:
                            break
                        res["audio_msgs"] += 1
                        res["decoded_bytes"] += int(pcm.shape[-1]) * 2
                        try:
                            b = (pcm.clip(-1, 1) * 32767).astype("int16").tobytes()
                            out = await down.resample(b, 24000, 8000)
                            res["resampled_bytes"] += len(out or b"")
                        except Exception:  # noqa: BLE001
                            pass
                elif tag == 2:
                    if len(res["text"]) < 8:
                        res["text"].append(payload.decode("utf-8", "ignore")[:20])

        task = _asyncio.create_task(reader())
        res["chunk_ms"] = chunk_ms
        if send and bridgesim:
            # Réplica EXACTA de MoshiBridge._forward_input: 8k en frames de 20ms →
            # up-resampler PERSISTENTE (incremental) → buffer a 80ms → send_pcm, en
            # tiempo real por `secs`. Reproduce la llamada real sin telefonear.
            res["bridgesim"] = True
            pcm_in = await _el_pcm24(text)
            d8 = create_stream_resampler()
            src8 = await d8.resample(pcm_in, 24000, 8000)  # "banda telefónica"
            up = create_stream_resampler()
            buf = bytearray()
            MIMI = 1920 * 2
            f8 = 160 * 2  # 20ms @ 8k = 160 muestras
            src_frames = [src8[i:i + f8] for i in range(0, len(src8), f8)]
            sil8 = b"\x00\x00" * 160
            n_iter = int(secs * 1000 / 20)
            for k in range(n_iter):
                fr = src_frames[k] if k < len(src_frames) else sil8
                pcm24 = await up.resample(fr, 8000, 24000)
                if pcm24:
                    buf.extend(pcm24)
                while len(buf) >= MIMI:
                    await client.send_pcm(bytes(buf[:MIMI]))
                    del buf[:MIMI]
                    res["sent"] += 1
                await _asyncio.sleep(0.02)
        elif send:
            spc = int(24000 * chunk_ms / 1000)  # muestras por chunk (80ms->1920)
            chunk = spc * 2
            frames: list[bytes] = []
            if speak:
                pcm_in = await _el_pcm24(text)
                if via8k:
                    # Replica EXACTA del camino de una llamada: 24k -> 8k (banda
                    # telefónica) -> 24k con el mismo create_stream_resampler que el
                    # bridge. Aísla si el up-resampler 8k->24k es el que mata el audio.
                    down8 = create_stream_resampler()
                    up24 = create_stream_resampler()
                    pcm8 = await down8.resample(pcm_in, 24000, 8000)
                    pcm_in = await up24.resample(pcm8, 8000, 24000)
                    res["via8k"] = True
                res["input_pcm_bytes"] = len(pcm_in)
                frames = [pcm_in[i:i + chunk] for i in range(0, len(pcm_in), chunk)]
            silence = b"\x00\x00" * spc
            # Stream CONTINUO (~12s): voz + silencio de cola. chunk_ms controla el
            # tamaño del bloque: 80ms = 1 frame Mimi (moshi responde); 20ms = ¼ de
            # frame (reproduce la llamada real muda) — así se prueba la hipótesis.
            n_iter = int(12000 / chunk_ms)
            for k in range(n_iter):
                await client.send_pcm(frames[k] if k < len(frames) else silence)
                res["sent"] += 1
                await _asyncio.sleep(chunk_ms / 1000)
        await _asyncio.sleep(2)
        task.cancel()
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"
    finally:
        await client.close()
    return JSONResponse(res)


# ── Saliente: Riverz (o un test) dispara /dial → colocamos la llamada ──────────
@app.post("/dial")
async def dial(request: Request) -> JSONResponse:
    body = await request.json()
    call_id = body.get("call_id")
    if not call_id:
        return JSONResponse({"error": "call_id required"}, status_code=400)
    if not (TELNYX_API_KEY and TELNYX_ACCOUNT_SID and TELNYX_APPLICATION_SID):
        return JSONResponse({"error": "telnyx not configured"}, status_code=503)

    ctx = await api.get_context(call_id=call_id)
    to_number = ctx.get("phone") or ctx.get("contact", {}).get("phone")
    from_number = (ctx.get("sip") or {}).get("caller_number") or TELNYX_PHONE_NUMBER
    if not to_number:
        return JSONResponse({"error": "no destination phone"}, status_code=422)

    texml_url = f"{PUBLIC_URL}/answer?call_id={call_id}"
    url = f"https://api.telnyx.com/v2/texml/Accounts/{TELNYX_ACCOUNT_SID}/Calls"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            url,
            data={
                "ApplicationSid": TELNYX_APPLICATION_SID,
                "To": to_number,
                "From": from_number,
                "Url": texml_url,
            },
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
        )
    ok = resp.status_code < 300
    logger.info("dial %s -> %s (%s)", call_id, resp.status_code, to_number)
    return JSONResponse({"ok": ok, "status": resp.status_code}, status_code=200 if ok else 502)


# ── TeXML: arranca el media stream bidireccional hacia /ws ─────────────────────
@app.api_route("/answer", methods=["GET", "POST"])
async def answer(call_id: str | None = Query(default=None)) -> HTMLResponse:
    # `&` debe ir escapado como `&amp;` dentro del XML.
    ws_url = _wss(f"/ws?call_id={call_id}" if call_id else "/ws")
    texml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{ws_url}" bidirectionalMode="rtp"></Stream>'
        "</Connect><Pause length=\"600\"/></Response>"
    )
    return HTMLResponse(content=texml, media_type="application/xml")


# ── Media stream: el corazón ──────────────────────────────────────────────────
@app.websocket("/ws")
async def ws(websocket: WebSocket, call_id: str | None = Query(default=None)) -> None:
    await websocket.accept()

    # Telnyx envía "connected" y luego "start" (con stream_id + call_control_id).
    try:
        _connected = json.loads(await websocket.receive_text())  # noqa: F841
        start_msg = json.loads(await websocket.receive_text())
    except Exception as e:
        logger.warning("ws: handshake inválido: %s", e)
        await websocket.close()
        return

    start = start_msg.get("start", {})
    stream_id = start_msg.get("stream_id")
    call_control_id = start.get("call_control_id")
    outbound_encoding = start.get("media_format", {}).get("encoding", "PCMU")
    caller = start.get("from", "")
    did = start.get("to", "")

    # Contexto: saliente por call_id; entrante por DID + caller.
    try:
        if call_id:
            ctx = await api.get_context(call_id=call_id)
        else:
            ctx = await api.get_context(did=did, caller=caller)
    except Exception as e:
        logger.warning("ws: get_context falló: %s", e)
        ctx = {}
    resolved_call_id = call_id or ctx.get("call_id")

    serializer = TelnyxFrameSerializer(
        stream_id=stream_id,
        call_control_id=call_control_id,
        outbound_encoding=outbound_encoding,
        inbound_encoding="PCMU",
        api_key=TELNYX_API_KEY or None,
    )
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )

    model = ctx.get("model") or ctx
    mode = model.get("mode", "pipeline")
    realtime = model.get("realtime") or {}

    transcript: list[dict] = []

    def collect(role: str, text: str) -> None:
        transcript.append({"role": role, "text": text})

    # ── Modo realtime full-duplex (PersonaPlex/Moshi) — definitivo, sin LiveKit
    if mode == "realtime" and realtime.get("base_url"):
        # PersonaPlex necesita un voice_prompt (.pt) de su set de 18 voces + un
        # text_prompt (persona). Mapea la voz del contexto a una PP; default NATF2.
        _PP = {
            "NATF0", "NATF1", "NATF2", "NATF3", "NATM0", "NATM1", "NATM2", "NATM3",
            "VARF0", "VARF1", "VARF2", "VARF3", "VARF4",
            "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
        }
        vid = ((ctx.get("voice") or {}).get("voice_id") or "").upper()
        pp_voice = vid if vid in _PP else "NATF2"
        # moshi text_prompt = persona CORTA (una línea) por query string. El
        # system prompt completo (largo) hace un query gigante que rompe/enlentece
        # el /api/chat del moshi.server (era el "sin handshake"). Cap corto.
        raw_persona = (
            ctx.get("voice_persona")
            or ctx.get("instructions")
            or ctx.get("system_prompt")
            or ctx.get("prompt")
            or "Eres un recepcionista amable."
        )
        # FORZAR IDIOMA: la voz por defecto (NATF2) es inglesa y "tira" a inglés.
        # Ponemos la directiva de idioma AL FRENTE del text_prompt (y siempre, aunque
        # se recorte) para que PersonaPlex hable en el idioma del agente.
        lang = str(ctx.get("language") or "es").lower()
        if lang.startswith("es"):
            directive = "IMPORTANTE: habla SOLO en español latinoamericano, natural y breve. Nunca en inglés. "
        else:
            directive = "IMPORTANT: speak ONLY in English, natural and brief. "
        persona = (directive + " ".join(str(raw_persona).split()))[:200]
        bridge = MoshiBridge(
            realtime["base_url"],
            realtime.get("api_key"),
            voice=pp_voice,
            text_prompt=persona,
            on_transcript=collect,
        )
        pipeline = Pipeline([transport.input(), bridge, transport.output()])
        greeting = None
    else:
        # ── Modo pipeline (Deepgram + Anthropic + ElevenLabs) ──
        pipeline, greeting = _build_pipeline(ctx, model, transport)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
            enable_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def _on_connected(_t, _c):  # noqa: ANN001
        if greeting:
            from pipecat.frames.frames import TTSSpeakFrame  # VERSION
            await task.queue_frames([TTSSpeakFrame(greeting)])

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnected(_t, _c):  # noqa: ANN001
        await task.cancel()

    started = time.time()
    runner = PipelineRunner(handle_sigint=False)
    try:
        await runner.run(task)
    except Exception as e:
        logger.warning("ws: pipeline error: %s", e)
    finally:
        duration = int(time.time() - started)
        if resolved_call_id:
            with suppress(Exception):
                await api.post_result(
                    {
                        "call_id": resolved_call_id,
                        "status": "completed",
                        "duration_seconds": duration,
                        "transcript": transcript,
                    }
                )
        logger.info("ws: llamada %s terminada (%ds)", resolved_call_id, duration)


def _build_pipeline(ctx: dict, model: dict, transport):  # noqa: ANN001
    """Modo pipeline. Imports perezosos: si tu versión de pipecat difiere en
    estos módulos, sólo afecta a este modo, no al full-duplex. # VERSION"""
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )
    from pipecat.services.anthropic.llm import AnthropicLLMService
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

    stt_cfg = model.get("stt", {})
    llm_cfg = model.get("llm", {})
    tts_cfg = model.get("tts", {})

    try:
        from deepgram import LiveOptions

        stt = DeepgramSTTService(
            api_key=stt_cfg.get("api_key") or os.getenv("DEEPGRAM_API_KEY", ""),
            live_options=LiveOptions(
                model=stt_cfg.get("model", "nova-3"),
                language=stt_cfg.get("language", "multi"),
            ),
            audio_passthrough=True,
        )
    except Exception:
        stt = DeepgramSTTService(
            api_key=stt_cfg.get("api_key") or os.getenv("DEEPGRAM_API_KEY", ""),
            audio_passthrough=True,
        )

    llm = AnthropicLLMService(
        api_key=llm_cfg.get("api_key") or os.getenv("ANTHROPIC_API_KEY", ""),
        model=llm_cfg.get("model") or "claude-haiku-4-5-20251001",
    )
    # TTS por provider: elevenlabs (default) o cartesia (baja latencia). Sin Google/OpenAI.
    if (tts_cfg.get("provider") or "").lower() == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        tts = CartesiaTTSService(
            api_key=tts_cfg.get("api_key") or os.getenv("CARTESIA_API_KEY", ""),
            voice_id=tts_cfg.get("voice_id") or "",
            model=tts_cfg.get("model") or "sonic-2",
        )
    else:
        tts = ElevenLabsTTSService(
            api_key=tts_cfg.get("api_key") or os.getenv("ELEVENLABS_API_KEY", ""),
            voice_id=tts_cfg.get("voice_id"),
            model=tts_cfg.get("model") or "eleven_flash_v2_5",
        )

    system = ctx.get("instructions") or ctx.get("system_prompt") or ctx.get("prompt") or ""
    greeting = ctx.get("greeting")

    context = LLMContext(messages=[{"role": "system", "content": system}] if system else [])
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_agg,
            llm,
            tts,
            transport.output(),
            assistant_agg,
        ]
    )
    return pipeline, greeting


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
