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


@app.get("/moshi-test")
async def moshi_test(
    url: str | None = Query(default=None),
    voice: str = Query(default="NATF2"),
    send: bool = Query(default=True),
):
    """Debug (no phone call): connect the moshi client, optionally feed it silence,
    and log EVERY raw frame PersonaPlex returns (tag+len). Iterate the bridge safely."""
    import asyncio as _asyncio
    from moshi_client import MoshiClient

    import time as _t

    base = url or os.getenv("MOSHI_TEST_URL") or "wss://riverztest2--personaplex-serve.modal.run"
    client = MoshiClient(base, voice=voice, text_prompt="Hola, prueba.")
    res: dict = {"handshake": False, "connect_ms": None, "frames": [], "sent": 0, "error": None}
    try:
        _t0 = _t.monotonic()
        await client.connect()
        res["connect_ms"] = int((_t.monotonic() - _t0) * 1000)
        res["handshake"] = True

        async def reader() -> None:
            async for m in client._ws:  # raw: see every frame + tag
                if isinstance(m, (bytes, bytearray)):
                    res["frames"].append(f"b{len(m)}t{m[0] if m else -1}")
                else:
                    res["frames"].append(f"txt:{str(m)[:20]}")
                if len(res["frames"]) >= 60:
                    break

        task = _asyncio.create_task(reader())
        if send:
            silence = b"\x00\x00" * 1920  # 80ms of 24kHz int16 silence
            for _ in range(40):  # ~3.2s
                await client.send_pcm(silence)
                res["sent"] += 1
                await _asyncio.sleep(0.08)
        await _asyncio.sleep(4)
        task.cancel()
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"
    finally:
        await client.close()
    # compact the frame list
    res["frame_count"] = len(res["frames"])
    res["frames"] = res["frames"][:30]
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
        sys_prompt = (
            ctx.get("instructions")
            or ctx.get("system_prompt")
            or ctx.get("prompt")
            or "Eres un asistente telefónico amable. Responde en español, breve y natural."
        )
        bridge = MoshiBridge(
            realtime["base_url"],
            realtime.get("api_key"),
            voice=pp_voice,
            text_prompt=sys_prompt,
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
