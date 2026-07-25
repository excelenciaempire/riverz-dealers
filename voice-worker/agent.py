"""Worker de voz de Riverz sobre LiveKit Agents (Python v1.x).

Un agente telefónico que hace llamadas salientes y atiende entrantes a través de
un trunk SIP de Telnyx conectado a LiveKit Cloud. Toda la lógica de negocio vive
en el web app (Next.js); este worker sólo orquesta la llamada y reporta.

Pipeline STT -> LLM -> TTS (no speech-to-speech):
  Deepgram (STT) -> Anthropic (LLM) -> ElevenLabs (TTS)
  + turn detection multilingüe + VAD (silero).

Uso:
  python agent.py download-files   # baja pesos de VAD / turn-detector (build de imagen)
  python agent.py dev              # local con hot-reload y logs de color
  python agent.py start            # producción

NOTE (API v1.6.x): se usa el patrón clásico WorkerOptions + cli.run_app, que
sigue exportado y es el del ejemplo oficial `livekit-examples/outbound-caller-python`.
Las versiones recientes también exponen `AgentServer` + `@server.rtc_session(...)`
(https://docs.livekit.io/agents/start/voice-ai/) como alternativa equivalente.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from livekit import api as lkapi
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
    metrics,
)
from livekit.plugins import anthropic, deepgram, elevenlabs, openai, silero

# NOTE: MultilingualModel sigue en este path en 1.6.x. El plugin muestra un aviso
# de deprecación a favor de `livekit.agents.inference.TurnDetector` en el futuro:
# https://docs.livekit.io/agents/build/turns/turn-detector/
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from riverz_api import RiverzAPI
from tools import CallState, build_tools, hangup as _hangup

# Noise cancellation (BVCTelephony) mejora mucho el audio en telefonía, pero es un
# plugin aparte y opcional; si no está instalado, seguimos sin él (fail-soft).
try:
    from livekit.plugins import noise_cancellation
except Exception:  # pragma: no cover
    noise_cancellation = None

load_dotenv()

logger = logging.getLogger("riverz-voice")
logger.setLevel(logging.INFO)

AGENT_NAME = "riverz-voice"

# Mantiene refs fuertes a tasks de fondo (asyncio sólo guarda refs débiles).
_BG_TASKS: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return task


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _goodbye(lang: str) -> str:
    # Mensaje al cliente -> sigue el idioma del agente (no se traduce vía i18n del app).
    return "Thank you for your time. Goodbye!" if (lang or "es").startswith("en") \
        else "Gracias por tu tiempo. ¡Hasta luego!"


def _map_sip_status(code) -> str:
    """Mapea el SIP status code de un fallo de marcado a nuestro status."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return "failed"
    if code in (486, 600, 603):  # Busy Here / Busy Everywhere / Decline
        return "busy"
    if code in (408, 480, 484, 487):  # Timeout / Unavailable / Address Incomplete / Terminated
        return "no_answer"
    return "failed"


def _parse_call_metadata(ctx: JobContext) -> dict | None:
    """Lee el metadata de la llamada saliente. El contrato usa metadata de sala
    ({"call_id","workspace_id"}); aceptamos también el metadata del job (dispatch
    explícito) por robustez. Devuelve el dict si contiene call_id, si no None."""
    candidates = []
    try:
        candidates.append(ctx.job.metadata)
    except Exception:
        pass
    candidates.append(getattr(ctx.room, "metadata", None))
    for raw in candidates:
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict) and data.get("call_id"):
            return data
    return None


def _room_input_options() -> RoomInputOptions:
    if noise_cancellation is not None:
        try:
            return RoomInputOptions(noise_cancellation=noise_cancellation.BVCTelephony())
        except Exception:
            logger.debug("BVCTelephony no disponible; sigo sin noise cancellation")
    return RoomInputOptions()


def _wire_events(session: AgentSession, call_state: CallState, usage_collector) -> None:
    """Acumula transcript y métricas de uso durante la llamada."""

    # NOTE: evento y forma del item según docs v1.x (ConversationItemAddedEvent):
    # https://docs.livekit.io/agents/build/events/
    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        try:
            item = ev.item
            role = getattr(item, "role", None)
            if role not in ("assistant", "user"):
                return
            text = getattr(item, "text_content", None)
            if not text:
                return
            call_state.transcript.append(
                {
                    "role": "agent" if role == "assistant" else "customer",
                    "text": text,
                    "ts": _now_iso(),
                }
            )
        except Exception:
            logger.debug("error capturando transcript", exc_info=True)

    # NOTE: UsageCollector/UsageSummary siguen presentes en 1.6.x (marcados
    # deprecated a favor de ModelUsageCollector). Fail-soft: si algo cambia,
    # `usage` sale null y el resto del reporte no se ve afectado.
    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        try:
            usage_collector.collect(ev.metrics)
        except Exception:
            logger.debug("error recolectando métricas", exc_info=True)


def _usage_dict(usage_collector) -> dict | None:
    if usage_collector is None:
        return None
    try:
        s = usage_collector.get_summary()
        return {
            "stt_seconds": round(float(s.stt_audio_duration), 2),
            "llm_input_tokens": int(s.llm_prompt_tokens),
            "llm_output_tokens": int(s.llm_completion_tokens),
            "tts_chars": int(s.tts_characters_count),
        }
    except Exception:
        logger.debug("no se pudo construir usage", exc_info=True)
        return None


async def _summarize(context: dict, transcript: list[dict]) -> str | None:
    """Resumen corto (2-3 frases) en el idioma de la llamada. Fail-soft -> None.
    Usa el SDK de Anthropic directamente (dependencia transitiva del plugin) con
    un one-shot; si no hay API key o falla (p.ej. sin saldo), devuelve None."""
    if not transcript:
        return None
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic as anthropic_sdk
    except Exception:
        return None
    lang = (context or {}).get("language", "es")
    model = ((context or {}).get("llm") or {}).get("model", "claude-haiku-4-5")
    convo = "\n".join(f"{t['role']}: {t['text']}" for t in transcript)[:6000]
    prompt = (
        f"Resume esta llamada telefónica en 2-3 frases en '{lang}'. "
        f"Devuelve sólo el resumen, sin preámbulos.\n\n{convo}"
    )
    try:
        client = anthropic_sdk.AsyncAnthropic(api_key=key)
        resp = await client.messages.create(
            model=model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        text = " ".join(parts).strip()
        return text or None
    except Exception:
        logger.warning("no se pudo generar el resumen", exc_info=True)
        return None


async def _finalize(
    api: RiverzAPI,
    call_state: CallState,
    usage_collector,
    context: dict | None,
    *,
    error: str | None = None,
) -> None:
    """POST /result exactamente una vez (idempotente también en el servidor)."""
    if call_state.result_posted:
        return
    call_state.result_posted = True

    ended_at = _now_iso()
    status = call_state.status or ("completed" if call_state.answered_at else "failed")

    duration = None
    if call_state.answered_at:
        try:
            start = datetime.fromisoformat(call_state.answered_at)
            end = datetime.fromisoformat(ended_at)
            duration = max(0, int((end - start).total_seconds()))
        except Exception:
            duration = None

    summary = await _summarize(context or {}, call_state.transcript)

    payload = {
        "call_id": call_state.call_id,
        "status": status,
        "outcome": call_state.outcome,
        "outcome_details": call_state.outcome_details,
        "summary": summary,
        "transcript": call_state.transcript,
        "answered_at": call_state.answered_at,
        "ended_at": ended_at,
        "duration_seconds": duration,
        "usage": _usage_dict(usage_collector),
        "recording_url": call_state.recording_url,
        "error": error,
    }
    try:
        await api.post_result(payload)
        logger.info("resultado reportado: status=%s outcome=%s", status, call_state.outcome)
    except Exception:
        logger.exception("falló POST /result")
    finally:
        # Cierra el cliente HTTP recién después de reportar (es el último uso de `api`).
        await api.aclose()


# --- Abstracción de proveedor -------------------------------------------------
# Cada capa (stt/llm/tts) usa su plugin fijo (deepgram/anthropic/elevenlabs) con
# la env key, SALVO que el cfg traiga `base_url`: entonces se usa el plugin
# OpenAI-compatible de LiveKit apuntando a ese endpoint. Esto permite correr
# STT/LLM/TTS en Modal (vLLM / Nano-vLLM exponen API OpenAI-compatible), o el
# modo realtime (speech-to-speech) contra PersonaPlex vía Modal.
# NOTE: firmas verificadas en el plugin openai 1.6.x:
#   openai.STT(base_url, api_key, model, language)  · openai/stt.py
#   openai.LLM(base_url, api_key, model)            · openai/llm.py
#   openai.TTS(base_url, api_key, model, voice)     · openai/tts.py  (voice, no voice_id)
#   openai.realtime.RealtimeModel(base_url, api_key, model, voice)

# api_key placeholder: el AsyncClient de OpenAI exige una key aunque el endpoint
# self-hosted no la valide.
_OAI_PLACEHOLDER_KEY = "sk-local"


def _make_stt(cfg: dict):
    base_url = cfg.get("base_url")
    if base_url:
        kwargs: dict = {
            "base_url": base_url,
            "api_key": cfg.get("api_key") or _OAI_PLACEHOLDER_KEY,
            "model": cfg.get("model") or "whisper-1",
        }
        # "multi" es un concepto de Deepgram; para OpenAI/Whisper omitimos el idioma
        # (auto-detección) salvo que venga un código real.
        lang = cfg.get("language")
        if lang and lang != "multi":
            kwargs["language"] = lang
        return openai.STT(**kwargs)
    return deepgram.STT(
        model=cfg.get("model", "nova-3"),
        language=cfg.get("language", "multi"),
    )


def _make_llm(cfg: dict):
    base_url = cfg.get("base_url")
    if base_url:
        return openai.LLM(
            base_url=base_url,
            api_key=cfg.get("api_key") or _OAI_PLACEHOLDER_KEY,
            model=cfg.get("model") or "gpt-4o-mini",
        )
    # caching="ephemeral" activa prompt caching de Anthropic (system + tools + historial).
    return anthropic.LLM(
        model=cfg.get("model", "claude-haiku-4-5"),
        caching="ephemeral",
    )


def _make_tts(cfg: dict):
    base_url = cfg.get("base_url")
    if base_url:
        # response_format="wav": el emitter de LiveKit decodifica según el
        # formato que PIDE el cliente (no el Content-Type). "wav" es a prueba de
        # balas (auto-describe el sample rate; LiveKit resamplea). El wrapper de
        # Modal (VoxCPM) devuelve WAV real para "wav".
        return openai.TTS(
            base_url=base_url,
            api_key=cfg.get("api_key") or _OAI_PLACEHOLDER_KEY,
            model=cfg.get("model") or "tts-1",
            voice=cfg.get("voice_id") or "default",
            response_format="wav",
        )
    return elevenlabs.TTS(
        voice_id=cfg.get("voice_id"),
        model=cfg.get("model", "eleven_flash_v2_5"),
    )


def _try_build_realtime(context: dict):
    """Construye un RealtimeModel speech-to-speech desde context.realtime, o None → pipeline.

    Rutea por provider:
      - personaplex/nvidia → plugin oficial livekit-plugins-nvidia (adapter propio).
        PersonaPlex NO soporta tools: si el agente usa tools, cae al pipeline.
      - resto → endpoint OpenAI-Realtime-compatible.
    """
    rt = context.get("realtime") or {}
    base_url = rt.get("base_url")
    if not base_url:
        return None
    provider = (rt.get("provider") or "").lower()

    if provider in ("personaplex", "nvidia"):
        # PersonaPlex no tiene function-calling → los agentes con tools DEBEN usar
        # el pipeline (Deepgram→Claude→VoxCPM) para conservar create_order, etc.
        if context.get("tools_enabled"):
            logger.info("realtime=personaplex pero el agente usa tools; uso pipeline")
            return None
        try:
            from personaplex import build_personaplex_realtime

            return build_personaplex_realtime(context)
        except Exception:
            logger.warning("no se pudo construir PersonaPlex; uso pipeline", exc_info=True)
            return None

    try:
        from livekit.plugins.openai import realtime as openai_realtime

        kwargs: dict = {"base_url": base_url}
        if rt.get("model"):
            kwargs["model"] = rt["model"]
        if rt.get("api_key"):
            kwargs["api_key"] = rt["api_key"]
        voice_id = (context.get("voice") or {}).get("voice_id")
        if voice_id:
            kwargs["voice"] = voice_id
        return openai_realtime.RealtimeModel(**kwargs)
    except Exception:
        logger.warning("no se pudo construir RealtimeModel; se usará el pipeline", exc_info=True)
        return None


def _build_session(context: dict, vad) -> AgentSession:
    # Modo realtime (speech-to-speech) sin STT/TTS separados.
    if context.get("mode") == "realtime":
        rt = _try_build_realtime(context)
        if rt is not None:
            logger.info("sesión realtime (speech-to-speech) activada")
            # El RealtimeModel maneja VAD/turn-detection del lado del servidor.
            return AgentSession(llm=rt)
        logger.warning("mode=realtime pero sin endpoint viable; cayendo al pipeline")

    # Pipeline STT -> LLM -> TTS (con proveedor fijo o OpenAI-compatible por capa).
    return AgentSession(
        stt=_make_stt(context.get("stt") or {}),
        llm=_make_llm(context.get("llm") or {}),
        tts=_make_tts(context.get("voice") or {}),
        turn_detection=MultilingualModel(),
        vad=vad,
    )


async def _start_recording(ctx: JobContext, context: dict, call_state: CallState) -> None:
    """Inicia LiveKit Egress (audio-only) de la room a un bucket S3-compatible
    (Supabase Storage vía endpoint S3). Fail-soft: si faltan credenciales o falla,
    loguea y NO graba, sin romper la llamada."""
    rec = context.get("recording") or {}
    if not rec.get("enabled"):
        return
    bucket = os.getenv("RECORDING_S3_BUCKET")
    access = os.getenv("RECORDING_S3_ACCESS_KEY")
    secret = os.getenv("RECORDING_S3_SECRET_KEY")
    if not (bucket and access and secret):
        logger.warning("recording habilitado pero faltan credenciales S3; no se graba")
        return
    endpoint = os.getenv("RECORDING_S3_ENDPOINT") or None
    region = os.getenv("RECORDING_S3_REGION") or "auto"
    # Key determinística por call_id -> el backend puede firmar la URL sin adivinar.
    key = f"voice-recordings/{call_state.call_id}.ogg"

    s3_kwargs = dict(access_key=access, secret=secret, bucket=bucket, region=region)
    if endpoint:  # Supabase / MinIO / R2 requieren endpoint + path-style
        s3_kwargs["endpoint"] = endpoint
        s3_kwargs["force_path_style"] = True

    try:
        info = await ctx.api.egress.start_room_composite_egress(
            lkapi.RoomCompositeEgressRequest(
                room_name=ctx.room.name,
                audio_only=True,
                file_outputs=[
                    lkapi.EncodedFileOutput(
                        file_type=lkapi.EncodedFileType.OGG,  # audio Opus -> .ogg
                        filepath=key,
                        s3=lkapi.S3Upload(**s3_kwargs),
                    )
                ],
            )
        )
        call_state.egress_id = getattr(info, "egress_id", "") or ""
        call_state.recording_key = key
        # URL best-effort (el egress sube el archivo al cerrarse la room).
        call_state.recording_url = (
            f"{endpoint.rstrip('/')}/{bucket}/{key}" if endpoint else f"s3://{bucket}/{key}"
        )
        logger.info("egress iniciado (%s) -> %s", call_state.egress_id, key)
    except Exception:
        logger.warning("no se pudo iniciar egress; la llamada sigue sin grabación", exc_info=True)


async def _timeout_guard(session: AgentSession, context: dict, call_state: CallState) -> None:
    """Timeout duro: al superar max_call_seconds, despedida breve y colgar."""
    max_seconds = int(context.get("max_call_seconds") or 300)
    try:
        await asyncio.sleep(max_seconds)
    except asyncio.CancelledError:
        return
    logger.info("max_call_seconds (%s) alcanzado; cerrando llamada", max_seconds)
    try:
        await session.say(_goodbye(context.get("language", "es")))
    except Exception:
        pass
    if call_state.status is None:
        call_state.status = "completed"
    await _hangup()


async def _run_outbound(ctx: JobContext, api: RiverzAPI, call_state: CallState, vad, meta: dict) -> None:
    call_state.direction = "outbound"
    call_state.call_id = meta.get("call_id", "")

    # Marca la llamada como dialing en el servidor y trae la config.
    context = await api.get_context(call_id=meta["call_id"])
    call_state.call_id = context.get("call_id", call_state.call_id)

    sip = context.get("sip") or {}
    # Identidad del participante telefónico (la fijamos nosotros al marcar) -> la
    # necesita transfer_to_human para el SIP REFER.
    identity = f"caller-{call_state.call_id}"
    call_state.phone_identity = identity

    session = _build_session(context, vad)
    usage_collector = metrics.UsageCollector()
    _wire_events(session, call_state, usage_collector)
    agent = Agent(
        instructions=context.get("system_prompt", ""),
        tools=build_tools(
            call_state=call_state,
            api=api,
            tools_enabled=context.get("tools_enabled") or [],
            transfer_number=(context.get("transfer") or {}).get("number"),
        ),
    )

    # El reporte de resultado se hace SIEMPRE en el shutdown (guardado por flag).
    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context))

    # Arranca la sesión en paralelo mientras marcamos (patrón del ejemplo oficial).
    session_task = _spawn(
        session.start(agent=agent, room=ctx.room, room_input_options=_room_input_options())
    )

    req_kwargs = dict(
        room_name=ctx.room.name,
        sip_trunk_id=sip.get("trunk_id"),
        sip_call_to=context.get("phone"),
        participant_identity=identity,
        wait_until_answered=True,  # bloquea hasta que contesten
    )
    # sip_number fija el caller ID (número "From"); sólo si viene definido.
    if sip.get("caller_number"):
        req_kwargs["sip_number"] = sip["caller_number"]

    try:
        # NOTE: create_sip_participant + wait_until_answered lanza TwirpError con
        # metadata['sip_status_code'] al fallar el marcado:
        # https://docs.livekit.io/sip/outbound-calls/
        await ctx.api.sip.create_sip_participant(lkapi.CreateSIPParticipantRequest(**req_kwargs))
    except lkapi.TwirpError as e:
        code = e.metadata.get("sip_status_code") if getattr(e, "metadata", None) else None
        call_state.status = _map_sip_status(code)
        logger.warning("fallo al marcar SIP: %s (status %s)", getattr(e, "message", e), code)
        await _finalize(api, call_state, usage_collector, context, error=f"sip:{code}:{getattr(e, 'message', '')}")
        ctx.shutdown()
        return

    # Contestaron.
    call_state.answered_at = _now_iso()
    # Grabación (si está habilitada) una vez que hay audio en la room.
    await _start_recording(ctx, context, call_state)
    await session_task

    greeting = context.get("greeting")
    if greeting:
        await session.say(greeting)

    _spawn(_timeout_guard(session, context, call_state))


async def _run_inbound(ctx: JobContext, api: RiverzAPI, call_state: CallState, vad) -> None:
    call_state.direction = "inbound"

    # El llamante ya está en la sala (dispatch rule SIP). Esperamos al participante
    # y leemos DID + caller de sus atributos SIP.
    # NOTE: atributos SIP (https://docs.livekit.io/reference/telephony/sip-participant/):
    #   sip.trunkPhoneNumber -> número marcado por el usuario (nuestro DID)
    #   sip.phoneNumber      -> número de origen del llamante (caller)
    participant = await ctx.wait_for_participant()
    attrs = getattr(participant, "attributes", {}) or {}
    did = attrs.get("sip.trunkPhoneNumber")
    caller = attrs.get("sip.phoneNumber")

    context = await api.get_context(did=did, caller=caller)
    call_state.call_id = context.get("call_id", "")
    call_state.answered_at = _now_iso()
    # El participante telefónico ya está en la room -> guardamos su identity para transferir.
    call_state.phone_identity = getattr(participant, "identity", "") or ""

    session = _build_session(context, vad)
    usage_collector = metrics.UsageCollector()
    _wire_events(session, call_state, usage_collector)
    agent = Agent(
        instructions=context.get("system_prompt", ""),
        tools=build_tools(
            call_state=call_state,
            api=api,
            tools_enabled=context.get("tools_enabled") or [],
            transfer_number=(context.get("transfer") or {}).get("number"),
        ),
    )

    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context))

    # Grabación (si está habilitada).
    await _start_recording(ctx, context, call_state)

    await session.start(agent=agent, room=ctx.room, room_input_options=_room_input_options())

    greeting = context.get("greeting")
    if greeting:
        await session.say(greeting)

    _spawn(_timeout_guard(session, context, call_state))


async def entrypoint(ctx: JobContext) -> None:
    logger.info("job entrante en sala %s", ctx.room.name)
    await ctx.connect()

    api = RiverzAPI()
    call_state = CallState()
    # VAD precargado en prewarm; si no, carga aquí (fail-soft).
    vad = ctx.proc.userdata.get("vad") if ctx.proc.userdata else None
    if vad is None:
        vad = silero.VAD.load()

    meta = _parse_call_metadata(ctx)
    try:
        if meta:  # saliente: hay call_id en el metadata
            await _run_outbound(ctx, api, call_state, vad, meta)
        else:  # entrante: llega por dispatch rule SIP, sin metadata de llamada
            await _run_inbound(ctx, api, call_state, vad)
    except Exception as e:
        # Nunca dejamos caer el proceso por el error de una llamada.
        logger.exception("error en entrypoint")
        if call_state.status is None:
            call_state.status = "failed"
        if call_state.call_id:
            # _finalize reporta y cierra el cliente HTTP (guardado por flag).
            await _finalize(api, call_state, None, meta, error=str(e))
        else:
            # Sin call_id no hay a quién reportar; sólo liberamos el cliente.
            await api.aclose()
    # En el flujo normal el cliente HTTP se cierra dentro de _finalize, que corre
    # como shutdown callback cuando termina la llamada (así sigue vivo hasta el POST).


def prewarm(proc) -> None:
    """Precarga pesos pesados una vez por proceso (VAD)."""
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    # agent_name -> el worker sólo corre por dispatch explícito (salientes) y
    # recibe entrantes vía dispatch rule SIP apuntando a este mismo nombre.
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        )
    )
