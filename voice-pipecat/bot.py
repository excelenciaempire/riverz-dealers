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
    key = os.getenv("ELEVENLABS_API_KEY", "") or os.getenv("ELEVEN_API_KEY", "")
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


async def _el_ulaw8(phrase: str) -> bytes:
    """ElevenLabs TTS -> μ-law 8kHz (PCMU) — el formato que habla un 'llamante'
    de Telnyx. Se usa en /selftest para simular al usuario sin llamada real."""
    key = os.getenv("ELEVENLABS_API_KEY", "") or os.getenv("ELEVEN_API_KEY", "")
    if not key:
        return b""
    vid = "XrExE9yKIg1WjnnlVkGX"  # Matilda (es-419)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=ulaw_8000"
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


# ── Introspección: qué clases de turn-strategy y qué campos hay en ESTA versión
# de pipecat (para configurar el fin de turno sin adivinar).
@app.get("/turns-debug")
async def turns_debug():
    import importlib
    import pkgutil

    out: dict = {}
    try:
        import pipecat
        out["pipecat_version"] = getattr(pipecat, "__version__", "?")
    except Exception as e:  # noqa: BLE001
        out["pipecat_version"] = f"ERR {e}"
    for sub in [
        "user_stop", "user_start", "turn_stop_strategies", "turn_start_strategies",
        "user_turn_strategies", "smart_turn",
    ]:
        try:
            m = importlib.import_module(f"pipecat.turns.{sub}")
            out[sub] = [n for n in dir(m) if "Strateg" in n or "Turn" in n or "Config" in n]
            if hasattr(m, "__path__"):
                out[sub + "__mods"] = [x.name for x in pkgutil.iter_modules(m.__path__)]
        except Exception as e:  # noqa: BLE001
            out[sub] = f"ERR {type(e).__name__}: {e}"
    try:
        from pipecat.processors.aggregators.llm_response_universal import (
            LLMUserAggregatorParams,
        )
        mf = getattr(LLMUserAggregatorParams, "model_fields", None)
        out["LLMUserAggregatorParams_fields"] = (
            list(mf.keys()) if mf else [f for f in dir(LLMUserAggregatorParams) if not f.startswith("_")]
        )
    except Exception as e:  # noqa: BLE001
        out["params_err"] = str(e)
    return JSONResponse(out)


# ── Auto-test SIN teléfono: un "llamante sintético" corre contra el pipeline ───
# real (localhost /ws), habla en español vía ElevenLabs y mide cuántos turnos
# responde el bot y con qué latencia. Así iteramos el turn-taking sin llamar a
# nadie. Requiere un call_id real (fila voice_calls) para que /ws resuelva el
# contexto/stack. GET /selftest?call_id=...&phrases=Hola|Otra frase
@app.get("/selftest")
async def selftest(
    call_id: str = Query(...),
    phrases: str = Query(default="Hola, buenas|¿Cuánto cuesta el envío?"),
    turn_wait: float = Query(default=6.0),
):
    import asyncio as _a
    import base64 as _b64
    import json as _json
    import time as _t

    import websockets as _ws

    plist = [p for p in phrases.split("|") if p.strip()]
    report: dict = {"call_id": call_id, "phrases": plist, "greeting_bot_ms": 0, "turns": [], "error": None}
    _port = os.getenv("PORT", "8080")
    ws_url = f"ws://localhost:{_port}/ws?call_id={call_id}"
    SIL = b"\xff" * 160  # 20ms de silencio μ-law
    st = {"listening": False, "bot_ms": 0, "first_bot": None}

    def _b(x: bytes) -> str:
        return _b64.b64encode(x).decode()

    try:
        async with _ws.connect(ws_url, max_size=None, open_timeout=30) as ws:
            await ws.send(_json.dumps({"event": "connected"}))
            await ws.send(_json.dumps({
                "event": "start", "stream_id": "selftest",
                "start": {"call_control_id": "selftest",
                          "media_format": {"encoding": "PCMU", "sample_rate": 8000, "channels": 1},
                          "from": "+10000000000", "to": "+10000000001"},
            }))

            async def receiver():
                async for msg in ws:
                    try:
                        m = _json.loads(msg)
                    except Exception:
                        continue
                    if m.get("event") == "media" and m.get("media", {}).get("payload"):
                        if st["listening"]:
                            if st["first_bot"] is None:
                                st["first_bot"] = _t.monotonic()
                            st["bot_ms"] += 20  # cada frame = 20ms

            rtask = _a.create_task(receiver())

            async def send_ulaw(data: bytes):
                for i in range(0, len(data), 160):
                    ch = data[i:i + 160]
                    if len(ch) < 160:
                        ch = ch + b"\xff" * (160 - len(ch))
                    await ws.send(_json.dumps({"event": "media", "media": {"payload": _b(ch)}}))
                    await _a.sleep(0.02)

            async def send_silence(secs: float):
                for _ in range(int(secs / 0.02)):
                    await ws.send(_json.dumps({"event": "media", "media": {"payload": _b(SIL)}}))
                    await _a.sleep(0.02)

            async def wait_quiet(max_s: float = 8.0):
                """Espera a que el bot deje de hablar (sin audio por 0.6s) para no
                medir solapado con el turno anterior."""
                deadline = _t.monotonic() + max_s
                last = st["bot_ms"]
                quiet_since = _t.monotonic()
                while _t.monotonic() < deadline:
                    await _a.sleep(0.1)
                    if st["bot_ms"] != last:
                        last = st["bot_ms"]
                        quiet_since = _t.monotonic()
                    elif _t.monotonic() - quiet_since > 0.6:
                        return

            # Saludo: espera corta (solo confirmar que existe, sin detalle)
            st["listening"] = True
            await _a.sleep(0.3)
            await wait_quiet(3.0)
            report["greeting_bot_ms"] = st["bot_ms"]

            for ph in plist:
                ulaw = await _el_ulaw8(ph)
                if not ulaw:
                    report["turns"].append({"said": ph, "error": "TTS vacío (¿ELEVENLABS_API_KEY?)"})
                    continue
                await wait_quiet(8.0)            # ESPERAR que el bot termine su
                                                 # respuesta anterior (como una
                                                 # persona) antes de hablar, si no
                                                 # lo interrumpimos y no procesa el turno
                st["bot_ms"] = 0
                st["first_bot"] = None
                await send_silence(0.2)
                await send_ulaw(ulaw)
                t_end = _t.monotonic()
                st["first_bot"] = None           # medir desde que YO terminé
                await send_silence(0.8)          # gatilla el fin de turno (VAD 0.5)
                # CORTA apenas detecta respuesta (solo queremos responde sí/no +
                # latencia) → no esperamos la respuesta completa → no gasta de más.
                waited = 0.0
                while waited < turn_wait:
                    await _a.sleep(0.1)
                    waited += 0.1
                    if st["first_bot"] and st["bot_ms"] >= 200:
                        break
                lat = int((st["first_bot"] - t_end) * 1000) if st["first_bot"] else None
                report["turns"].append({
                    "said": ph,
                    "bot_responded": bool(st["first_bot"]) and st["bot_ms"] >= 200,
                    "latency_ms": lat,
                    "bot_audio_ms": st["bot_ms"],
                })
            # Colgar de inmediato → corta cualquier TTS/LLM en curso (no gasta más)

            rtask.cancel()
    except Exception as e:  # noqa: BLE001
        report["error"] = f"{type(e).__name__}: {e}"
    # Resumen
    ok = [t for t in report["turns"] if t.get("bot_responded")]
    report["summary"] = f"{len(ok)}/{len(plist)} turnos respondidos"
    return JSONResponse(report)


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
    # El VAD va en el AGGREGATOR (ver _build_pipeline), no acá: así la
    # finalización de turno es por VAD (0.5s de silencio = turno listo) en vez del
    # TurnAnalyzer "inteligente" que descartaba el primer turno (strategy None →
    # "lento + casi no responde"). Igual fijamos el sample rate del transport a 8k.
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
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

    # ── Motor de conversación ──────────────────────────────────────────────
    # realtime = S2S full-duplex (PersonaPlex / OpenAI Realtime / Gemini Live /
    # Nova Sonic). Si el motor elegido no está disponible (extra/clave/API), cae
    # a pipeline (STT+LLM+TTS) para que la llamada NUNCA quede muda.
    pipeline = None
    greeting = None
    if mode == "realtime" and realtime and realtime.get("provider"):
        try:
            built = _build_realtime(ctx, model, realtime, transport, collect)
        except Exception as e:  # noqa: BLE001
            logger.error("realtime build falló (%s) → pipeline", e)
            built = None
        if built is not None:
            pipeline, greeting = built
        else:
            logger.warning("realtime no disponible → usando pipeline")
    if pipeline is None:
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


def _env(*names: str) -> str:
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return ""


# ── Fábricas por capa. Cada proveedor con import perezoso: seleccionar uno que
# no esté instalado NO rompe el arranque; sólo falla al construirse esa capa
# (y ahí caemos a un default seguro). Los `id` coinciden con src/lib/voice/providers.ts.
def _build_stt(cfg: dict):  # noqa: ANN201
    p = (cfg.get("provider") or "deepgram").lower()
    key = cfg.get("api_key") or ""
    model = cfg.get("model") or ""
    lang = cfg.get("language") or "multi"
    if p == "openai":
        from pipecat.services.openai.stt import OpenAISTTService
        return OpenAISTTService(api_key=key or _env("OPENAI_API_KEY"), model=model or "gpt-4o-transcribe")
    if p == "groq":
        from pipecat.services.groq.stt import GroqSTTService
        return GroqSTTService(api_key=key or _env("GROQ_API_KEY"), model=model or "whisper-large-v3-turbo")
    if p == "assemblyai":
        from pipecat.services.assemblyai.stt import AssemblyAISTTService
        return AssemblyAISTTService(api_key=key or _env("ASSEMBLYAI_API_KEY"))
    if p == "gladia":
        from pipecat.services.gladia.stt import GladiaSTTService
        return GladiaSTTService(api_key=key or _env("GLADIA_API_KEY"))
    # deepgram (default, multi-idioma)
    from pipecat.services.deepgram.stt import DeepgramSTTService
    try:
        from deepgram import LiveOptions
        return DeepgramSTTService(
            api_key=key or _env("DEEPGRAM_API_KEY"),
            live_options=LiveOptions(
                model=model or "nova-3",
                language=lang,
                interim_results=True,   # parciales → el VAD corta antes
                endpointing=300,        # ms de silencio para finalizar (ágil)
                utterance_end_ms="1000",
                vad_events=True,
                smart_format=True,
                punctuate=True,
            ),
            audio_passthrough=True,
        )
    except Exception:
        return DeepgramSTTService(api_key=key or _env("DEEPGRAM_API_KEY"), audio_passthrough=True)


def _build_llm(cfg: dict):  # noqa: ANN201
    p = (cfg.get("provider") or "anthropic").lower()
    key = cfg.get("api_key") or ""
    model = cfg.get("model") or ""
    base_url = cfg.get("base_url") or None
    if p == "anthropic":
        from pipecat.services.anthropic.llm import AnthropicLLMService
        return AnthropicLLMService(
            api_key=key or _env("ANTHROPIC_API_KEY"),
            model=model or "claude-haiku-4-5-20251001",
        )
    if p == "gemini":
        from pipecat.services.google.llm import GoogleLLMService
        return GoogleLLMService(
            api_key=key or _env("GEMINI_API_KEY", "GOOGLE_API_KEY"),
            model=model or "gemini-2.5-flash",
        )
    # Punto A: hosts serverless de modelos ABIERTOS (pago-por-uso, $0 ocioso) +
    # openai/groq/openai_compatible → todos hablan API OpenAI-compatible.
    from pipecat.services.openai.llm import OpenAILLMService
    # (provider) -> (base_url, env vars de la clave, modelo por defecto)
    OPENAI_COMPAT = {
        "groq": ("https://api.groq.com/openai/v1", ("GROQ_API_KEY",), "llama-3.3-70b-versatile"),
        "deepinfra": ("https://api.deepinfra.com/v1/openai", ("DEEPINFRA_API_KEY", "DEEPINFRA_TOKEN"), "Qwen/Qwen3-72B-Instruct"),
        "together": ("https://api.together.xyz/v1", ("TOGETHER_API_KEY",), "Qwen/Qwen3-72B-Instruct"),
        "fireworks": ("https://api.fireworks.ai/inference/v1", ("FIREWORKS_API_KEY",), "accounts/fireworks/models/qwen3-72b-instruct"),
        "deepseek": ("https://api.deepseek.com", ("DEEPSEEK_API_KEY",), "deepseek-chat"),
        "openai": (None, ("OPENAI_API_KEY",), "gpt-4o-mini"),
    }
    if p in OPENAI_COMPAT:
        default_url, env_names, default_model = OPENAI_COMPAT[p]
        base_url = base_url or default_url
        key = key or _env(*env_names)
        model = model or default_model
    kwargs = {"api_key": key, "model": model or "gpt-4o-mini"}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAILLMService(**kwargs)


def _build_tts(cfg: dict):  # noqa: ANN201
    p = (cfg.get("provider") or "elevenlabs").lower()
    key = cfg.get("api_key") or ""
    model = cfg.get("model") or ""
    voice = cfg.get("voice_id") or ""
    if p == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService
        return CartesiaTTSService(
            api_key=key or _env("CARTESIA_API_KEY"), voice_id=voice, model=model or "sonic-2"
        )
    if p == "rime":
        from pipecat.services.rime.tts import RimeTTSService
        return RimeTTSService(
            api_key=key or _env("RIME_API_KEY"), voice_id=voice or "cove", model=model or "mistv2"
        )
    if p == "playht":
        from pipecat.services.playht.tts import PlayHTTTSService
        return PlayHTTTSService(
            api_key=key or _env("PLAYHT_API_KEY"),
            user_id=_env("PLAYHT_USER_ID"),
            voice_url=voice,
        )
    if p == "deepgram":
        from pipecat.services.deepgram.tts import DeepgramTTSService
        return DeepgramTTSService(api_key=key or _env("DEEPGRAM_API_KEY"), voice=model or "aura-2-thalia-en")
    if p == "openai":
        from pipecat.services.openai.tts import OpenAITTSService
        return OpenAITTSService(
            api_key=key or _env("OPENAI_API_KEY"), voice=voice or "nova", model=model or "gpt-4o-mini-tts"
        )
    if p == "gemini":
        from pipecat.services.google.tts import GoogleTTSService
        return GoogleTTSService(
            api_key=key or _env("GEMINI_API_KEY", "GOOGLE_API_KEY"), voice_id=voice or "Kore"
        )
    if p == "hume":
        from pipecat.services.hume.tts import HumeTTSService
        return HumeTTSService(api_key=key or _env("HUME_API_KEY"), voice=voice)
    # elevenlabs (default / fallback). voice_id OBLIGATORIO: sin él ElevenLabs
    # lanza excepción; usamos Matilda (es-419) como default para no quedar mudos.
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
    return ElevenLabsTTSService(
        api_key=key or _env("ELEVENLABS_API_KEY", "ELEVEN_API_KEY"),
        voice_id=voice or "XrExE9yKIg1WjnnlVkGX",
        model=model or "eleven_flash_v2_5",
    )


def _build_pipeline(ctx: dict, model: dict, transport):  # noqa: ANN001
    """Modo pipeline STT→LLM→TTS. Cada capa se arma con su fábrica; si un
    proveedor falla al construirse, cae al default seguro (deepgram/anthropic/
    elevenlabs) para no dejar la llamada muda. # VERSION"""
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
        LLMUserAggregatorParams,
    )

    def _mk_vad():
        vp = VADParams(stop_secs=0.5)
        try:
            return SileroVADAnalyzer(sample_rate=8000, params=vp)
        except TypeError:
            return SileroVADAnalyzer(params=vp)

    stt_cfg = model.get("stt", {})
    llm_cfg = model.get("llm", {})
    # OJO: el contexto envía la capa TTS bajo "voice" (no "tts"). Leer "voice"
    # primero; sin esto el TTS SIEMPRE caía al default (ElevenLabs) ignorando la
    # config del admin.
    tts_cfg = model.get("voice") or model.get("tts") or {}

    try:
        stt = _build_stt(stt_cfg)
    except Exception as e:  # noqa: BLE001
        logger.error("STT %s falló (%s) → deepgram", stt_cfg.get("provider"), e)
        stt = _build_stt({"provider": "deepgram", "language": stt_cfg.get("language")})
    try:
        llm = _build_llm(llm_cfg)
    except Exception as e:  # noqa: BLE001
        logger.error("LLM %s falló (%s) → anthropic", llm_cfg.get("provider"), e)
        llm = _build_llm({"provider": "anthropic"})
    try:
        tts = _build_tts(tts_cfg)
    except Exception as e:  # noqa: BLE001
        logger.error("TTS %s falló (%s) → elevenlabs", tts_cfg.get("provider"), e)
        tts = _build_tts({"provider": "elevenlabs", "voice_id": tts_cfg.get("voice_id")})

    system = ctx.get("instructions") or ctx.get("system_prompt") or ctx.get("prompt") or ""
    greeting = ctx.get("greeting")

    context = LLMContext(messages=[{"role": "system", "content": system}] if system else [])
    # FIN DE TURNO por TRANSCRIPCIÓN, no por el smart-turn (default). El default de
    # pipecat es TurnAnalyzerUserTurnStopStrategy(LocalSmartTurnAnalyzerV3), un modelo
    # ONNX que sobre audio TELEFÓNICO cuelga/no completa el turno (issue #3643 y lo
    # visto en /selftest: strategy None → no responde). Con TranscriptionUserTurnStop
    # el turno cierra ~0.7s después de la última palabra transcrita → responde ágil.
    # FIN DE TURNO por SILENCIO (VAD), NO por el smart-turn. El default de pipecat
    # 1.6.0 es TurnAnalyzerUserTurnStopStrategy (modelo ONNX) que sobre audio
    # telefónico clasifica mal las preguntas como "incompletas" → strategy None →
    # el turno 2+ no dispara el LLM. Lo reemplazamos por SpeechTimeoutUserTurnStop
    # (cierra el turno tras el silencio del VAD, 0.5s) → cada turno responde.
    up_kwargs: dict = {"vad_analyzer": _mk_vad(), "user_turn_stop_timeout": 1.2}
    try:
        from pipecat.turns.user_turn_strategies import UserTurnStrategies
        from pipecat.turns.user_start import VADUserTurnStartStrategy
        from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
        up_kwargs["user_turn_strategies"] = UserTurnStrategies(
            start=[VADUserTurnStartStrategy()],
            stop=[SpeechTimeoutUserTurnStopStrategy()],
        )
        logger.info("user_turn_strategies: VAD start + SpeechTimeout stop (sin smart-turn)")
    except Exception as e:  # noqa: BLE001
        logger.warning("turn strategies no aplicadas (%s) → default smart-turn", e)
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(**up_kwargs),
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


def _build_realtime(ctx: dict, model: dict, realtime: dict, transport, collect):  # noqa: ANN001
    """Motor S2S full-duplex por proveedor. Devuelve (pipeline, greeting) o None
    (→ el caller cae a pipeline). PersonaPlex usa el bridge de Modal; el resto
    (OpenAI Realtime / Gemini Live / Nova Sonic) son servicios S2S de pipecat."""
    provider = (realtime.get("provider") or "").lower()

    if provider == "personaplex":
        if not realtime.get("base_url"):
            return None
        return _build_personaplex(ctx, realtime, transport, collect)

    # ── S2S por API (OpenAI Realtime / Gemini Live / Nova Sonic) ──
    system = ctx.get("system_prompt") or ctx.get("instructions") or ctx.get("prompt") or ""
    voice = ((ctx.get("voice") or {}).get("voice_id")) or ""
    key = realtime.get("api_key") or ""
    rt_model = realtime.get("model") or ""

    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
    )

    svc = None
    if provider == "openai_realtime":
        try:
            from pipecat.services.openai_realtime_beta import OpenAIRealtimeBetaLLMService
        except Exception:
            from pipecat.services.openai.realtime import OpenAIRealtimeBetaLLMService  # type: ignore
        kwargs = {"api_key": key or _env("OPENAI_API_KEY")}
        if rt_model:
            kwargs["model"] = rt_model
        svc = OpenAIRealtimeBetaLLMService(**kwargs)
    elif provider == "gemini_live":
        from pipecat.services.gemini_multimodal_live.gemini import (
            GeminiMultimodalLiveLLMService,
        )
        kwargs = {"api_key": key or _env("GEMINI_API_KEY", "GOOGLE_API_KEY")}
        if rt_model:
            kwargs["model"] = rt_model
        if voice:
            kwargs["voice_id"] = voice
        svc = GeminiMultimodalLiveLLMService(**kwargs)
    elif provider == "aws_nova_sonic":
        from pipecat.services.aws_nova_sonic.aws import AWSNovaSonicLLMService
        kwargs = {
            "secret_access_key": _env("AWS_SECRET_ACCESS_KEY"),
            "access_key_id": _env("AWS_ACCESS_KEY_ID"),
            "region": _env("AWS_REGION") or "us-east-1",
        }
        if voice:
            kwargs["voice_id"] = voice
        svc = AWSNovaSonicLLMService(**kwargs)
    else:
        return None

    context = LLMContext(messages=[{"role": "system", "content": system}] if system else [])
    user_agg, assistant_agg = LLMContextAggregatorPair(context)
    pipeline = Pipeline(
        [transport.input(), user_agg, svc, transport.output(), assistant_agg]
    )
    # Estos motores hablan primero según el system prompt; sin greeting scripted.
    return pipeline, None


def _build_personaplex(ctx: dict, realtime: dict, transport, collect):  # noqa: ANN001
    """PersonaPlex/Moshi full-duplex vía el bridge de Modal (sin LiveKit)."""
    _PP = {
        "NATF0", "NATF1", "NATF2", "NATF3", "NATM0", "NATM1", "NATM2", "NATM3",
        "VARF0", "VARF1", "VARF2", "VARF3", "VARF4",
        "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
    }
    vid = ((ctx.get("voice") or {}).get("voice_id") or "").upper()
    pp_voice = vid if vid in _PP else "NATF2"
    raw_persona = (
        ctx.get("voice_persona")
        or ctx.get("instructions")
        or ctx.get("system_prompt")
        or ctx.get("prompt")
        or "Eres un recepcionista amable."
    )
    # FORZAR IDIOMA al frente (la voz PP tira a inglés); cap corto p/ handshake rápido.
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
    return Pipeline([transport.input(), bridge, transport.output()]), None


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
