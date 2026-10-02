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
import base64
import gzip
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone

import httpx

from dotenv import load_dotenv
from livekit import api as lkapi, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
    metrics,
)
from livekit.agents import llm as agents_llm
from livekit.agents import stt as agents_stt
from livekit.agents import tts as agents_tts
from livekit.plugins import anthropic, deepgram, elevenlabs, openai, silero

# NOTE: MultilingualModel sigue en este path en 1.6.x. El plugin muestra un aviso
# de deprecación a favor de `livekit.agents.inference.TurnDetector` en el futuro:
# https://docs.livekit.io/agents/build/turns/turn-detector/
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from rioplatense import sheismo_stream
from speakable import speakable_stream
from riverz_api import RiverzAPI
from tools import CallState, build_tools, hangup as _hangup
from fallback_audio import FALLBACK_NOTICE_GZIP_BASE64
from human_handoff import control_human_handoff
from voice_mailbox import capture_mailbox, transfer_definitively_rejected
from mailbox_audio import MAILBOX_NOTICE_GZIP_BASE64
from whatsapp_runtime import wait_for_whatsapp_customer, set_whatsapp_disconnect

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

# Repique: el default de LiveKit corta a los 30 s, y a móviles de LatAm eso llega
# a cancelar llamadas que recién estaban sonando (medido: CDRs con 487 a los 30 s
# exactos). Se puede ajustar sin redeploy con VOICE_RING_TIMEOUT_SECS.
RING_TIMEOUT_SECS = int(os.getenv("VOICE_RING_TIMEOUT_SECS", "45"))

# Reintento de marcado. La ruta internacional del carrier rebota de a ratos con
# 404 "unallocated" sobre números que sí existen (medido a Argentina: mismo
# número, 404 y contestada con minutos de diferencia), y Telnyx no reintenta por
# otra ruta. Un 404 real no cuesta nada ni hace sonar el teléfono, así que
# reintentar es barato. NO se reintentan ocupado/no contesta: son respuestas
# legítimas del destino.
DIAL_ATTEMPTS = int(os.getenv("VOICE_DIAL_ATTEMPTS", "3"))
DIAL_RETRY_DELAY_SECS = float(os.getenv("VOICE_DIAL_RETRY_DELAY_SECS", "6"))
_RETRYABLE_SIP_STATUS = {404, 500, 502, 503, 504}

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


def _still_there(lang: str) -> str:
    # Empujoncito cuando el cliente lleva rato callado, antes de colgar.
    return "Are you still there?" if (lang or "es").startswith("en") \
        else "¿Sigues ahí?"


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


def _is_ring_timeout(err) -> bool:
    """Cuando se agota el repique, LiveKit devuelve un error de timeout SIN
    sip_status_code ("sip request timed out"). Sin esto la llamada queda como
    'failed' con un error críptico en el registro, cuando simplemente no
    contestaron."""
    return "timed out" in str(getattr(err, "message", err) or "").lower()


def _is_capacity_limit(err) -> bool:
    """Telnyx/LiveKit reports exhausted concurrent channels as SIP 403.
    A generic 403 can also mean bad credentials, so only retry messages that
    explicitly describe channel/concurrency capacity."""
    if _sip_status_code(err) != 403:
        return False
    meta = getattr(err, "metadata", None) or {}
    text = " ".join([
        str(getattr(err, "message", err) or ""),
        " ".join(f"{key}={value}" for key, value in meta.items()),
    ]).lower()
    return any(token in text for token in (
        "channel limit",
        "concurrent call limit",
        "concurrency limit",
        "maximum concurrent",
        "no available channel",
    ))


def _sip_status_code(err) -> int | None:
    """SIP status code que viene en el TwirpError del marcado, si lo trae."""
    meta = getattr(err, "metadata", None) or {}
    try:
        return int(meta.get("sip_status_code"))
    except (TypeError, ValueError):
        return None


def _duration(seconds: float):
    """`google.protobuf.Duration` para los campos de tiempo de LiveKit. Devuelve
    None si el SDK instalado no expone el campo o falta protobuf: en ese caso el
    marcado sigue con el default del SDK en vez de romperse."""
    if not seconds or seconds <= 0:
        return None
    try:
        from google.protobuf.duration_pb2 import Duration

        if "ringing_timeout" not in lkapi.CreateSIPParticipantRequest.DESCRIPTOR.fields_by_name:
            return None
        return Duration(seconds=int(seconds))
    except Exception:  # pragma: no cover
        return None


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


def _room_input_options(human_handoff_enabled: bool = False) -> RoomInputOptions:
    options = {"delete_room_on_close": False} if human_handoff_enabled else {}
    if noise_cancellation is not None:
        try:
            return RoomInputOptions(noise_cancellation=noise_cancellation.BVCTelephony(), **options)
        except Exception:
            logger.debug("BVCTelephony no disponible; sigo sin noise cancellation")
    return RoomInputOptions(**options)


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
            # Marca de actividad para el guard de silencio: cualquier turno
            # refresca last_activity_at; solo el cliente refresca last_user_at.
            now = time.monotonic()
            call_state.last_activity_at = now
            if role == "user":
                call_state.last_user_at = now
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

    # Que el modelo se muera a mitad de llamada tiene que DEJAR RASTRO.
    #
    # El 2026-08-28, con Groq en el plan gratis, el agente saludo, contesto una
    # vez y se callo: el prompt son ~5.600 tokens y el techo son 8.000 por
    # minuto, asi que el segundo turno daba 429 siempre. El cliente siguio
    # hablando solo doce segundos y colgo. La llamada se reporto `completed`,
    # el comercio la pago y la rama «contesto» de la automatizacion es la que
    # corrio. Sin esto, ese fallo no aparece en ningun lado.
    def _on_error(ev) -> None:
        try:
            fuente = getattr(ev, "source", None)
            detalle = str(getattr(ev, "error", ev))[:300]
            # Solo interesa el cerebro: un hipo del TTS se oye, uno del LLM
            # deja al cliente hablando solo.
            if "llm" in f"{type(fuente).__module__}.{type(fuente).__name__}".lower() \
                    or "llm" in detalle.lower():
                call_state.llm_errors += 1
                call_state.last_llm_error = detalle
                logger.warning("fallo del LLM en llamada (%d): %s",
                               call_state.llm_errors, detalle)
        except Exception:
            logger.debug("no se pudo registrar el error de sesion", exc_info=True)

    # Suscribirse aparte y blindado: si esta version de livekit-agents no
    # emitiera "error", que se pierda el diagnostico — NUNCA la llamada. Este
    # bloque corre al armar cada sesion, asi que una excepcion acá se lleva
    # puesta la llamada entera, que es justo lo que veniamos a evitar.
    try:
        session.on("error", _on_error)
    except Exception:
        logger.warning("no se pudo escuchar los errores de sesion", exc_info=True)

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
    Usa el MISMO LLM del pipeline (Groq/OpenAI-compat vía context.llm.base_url, o
    Anthropic si no hay base_url) — así no depende del saldo de Anthropic."""
    if not transcript:
        return None
    lang = (context or {}).get("language", "es")
    llm_cfg = (context or {}).get("llm") or {}
    convo = "\n".join(f"{t['role']}: {t['text']}" for t in transcript)[:6000]
    prompt = (
        f"Resume esta llamada telefónica en 2-3 frases en '{lang}'. "
        f"Devuelve sólo el resumen, sin preámbulos.\n\n{convo}"
    )
    base_url = llm_cfg.get("base_url")
    # Camino 1: LLM OpenAI-compatible (Groq, etc.) — el que ya usa la llamada.
    if base_url:
        key = _llm_key(llm_cfg) or _OAI_PLACEHOLDER_KEY
        model = llm_cfg.get("model") or "llama-3.3-70b-versatile"
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(base_url=base_url, api_key=key)
            # gpt-oss razona antes de responder y el razonamiento SALE del mismo
            # presupuesto: medido, 131 de 177 tokens se iban en pensar y el
            # resumen llegaba cortado a media frase ("El asistente de voz").
            # Mismo tratamiento que en `_make_llm`, y margen de tokens de sobra.
            kw: dict = {"model": model, "max_tokens": 400,
                        "messages": [{"role": "user", "content": prompt}]}
            if "gpt-oss" in model.lower():
                kw["reasoning_effort"] = "low"
            try:
                resp = await client.chat.completions.create(**kw)
            except TypeError:
                kw.pop("reasoning_effort", None)
                resp = await client.chat.completions.create(**kw)
            return (resp.choices[0].message.content or "").strip() or None
        except Exception:
            logger.warning("resumen (openai-compat) falló", exc_info=True)
            return None
    # Camino 2: Anthropic (si el LLM es Claude y hay saldo).
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic as anthropic_sdk
        client = anthropic_sdk.AsyncAnthropic(api_key=os.environ["VOICE_WORKER_SECRET"] if llm_cfg.get("billing_url") else key, base_url=llm_cfg.get("billing_url"), max_retries=0)
        resp = await client.messages.create(
            model=llm_cfg.get("model") or "claude-haiku-4-5",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        return (" ".join(parts).strip()) or None
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
    lk_api=None,
) -> None:
    """POST /result exactamente una vez (idempotente también en el servidor)."""
    if call_state.result_posted:
        return
    call_state.result_posted = True

    # Cortar el egress AHORA (al terminar la llamada), no esperar a que la sala se
    # cierre sola por timeout — si no, la grabación queda más larga que la llamada
    # (capturaba el silencio posterior a que el cliente colgó).
    if call_state.egress_id and lk_api is not None:
        try:
            await lk_api.egress.stop_egress(
                lkapi.StopEgressRequest(egress_id=call_state.egress_id)
            )
            logger.info("egress detenido (%s)", call_state.egress_id)
        except Exception:
            logger.warning("no se pudo detener el egress", exc_info=True)

    ended_at = _now_iso()
    status = call_state.status or ("completed" if call_state.answered_at else "failed")

    # El agente dejó al cliente hablando solo.
    #
    # Dos señales juntas: el modelo falló durante la llamada Y el último turno
    # es del cliente. Cualquiera de las dos sola es normal —un 429 aislado del
    # que se recupera no arruina nada, y una llamada que termina con el cliente
    # diciendo «listo, gracias» está perfecta—, pero las dos a la vez son
    # exactamente la llamada rota: saludó, se quedó mudo, y del otro lado
    # alguien repitió «¿hola?» hasta colgar.
    #
    # Va a `failed` a propósito: así la rama «si no contestó» de la
    # automatización es la que corre, y el registro lo muestra con su motivo en
    # vez de un «Completada» que le miente al comercio que acaba de pagarla.
    ultimo_es_cliente = bool(call_state.transcript) and \
        call_state.transcript[-1].get("role") == "customer"
    agente_mudo = (
        status == "completed"
        and call_state.llm_errors > 0
        and not call_state.human_handoff_connected
        and ultimo_es_cliente
    )
    if agente_mudo:
        status = "failed"
        error = error or (
            f"llm_sin_respuesta: el modelo falló {call_state.llm_errors} vez/veces "
            f"y el cliente quedó sin respuesta. {call_state.last_llm_error or ''}"
        )[:500]
        logger.error(
            "llamada rota: el agente dejó de contestar tras %d fallo(s) del LLM",
            call_state.llm_errors,
        )

    duration = None
    if call_state.answered_at:
        try:
            start = datetime.fromisoformat(call_state.answered_at)
            end = datetime.fromisoformat(ended_at)
            duration = max(0, int((end - start).total_seconds()))
        except Exception:
            duration = None

    # Capacity is infrastructure backpressure, not a completed call. There is
    # no transcript to summarize and the backend will put the same row back in
    # the queue.
    summary = None if status == "capacity_limited" else await _summarize(
        context or {}, call_state.transcript
    )

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
        "usage": ({"stt_seconds": 0, "llm_input_tokens": 0, "llm_output_tokens": 0, "tts_chars": 0}
                  if (context or {}).get("mode") == "fallback" else _usage_dict(usage_collector)),
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
    # endpointing_ms bajo = Deepgram cierra el enunciado antes tras el silencio →
    # menos latencia (el turn-detector semántico igual decide el fin de turno).
    # no_delay/interim = emite parciales sin buffer. Fail-soft por versión.
    dg = dict(
        model=cfg.get("model", "nova-3"),
        language=cfg.get("language", "multi"),
        interim_results=True,
        endpointing_ms=100,
        no_delay=True,
    )
    try:
        return deepgram.STT(**dg)
    except TypeError:
        return deepgram.STT(
            model=cfg.get("model", "nova-3"),
            language=cfg.get("language", "multi"),
        )


def _llm_key(cfg: dict) -> str | None:
    """Key del LLM: la de la config (cifrada en la DB) o, si no hay, la env var
    del worker según el host del endpoint — así no hace falta guardar la key en
    la base. Lo usan `_make_llm` Y `_summarize`: cuando sólo lo tenía el
    primero, el resumen post-llamada mandaba el placeholder y moría con un 401
    en cada llamada cuya key vivía en el entorno."""
    key = cfg.get("api_key")
    if key:
        return key
    bl = (cfg.get("base_url") or "").lower()
    for needle, envs in (
        ("cerebras", ("CEREBRAS_API_KEY",)),
        ("groq", ("GROQ_API_KEY",)),
        ("googleapis", ("GEMINI_API_KEY", "GOOGLE_API_KEY")),
        ("deepinfra", ("DEEPINFRA_API_KEY",)),
        ("together", ("TOGETHER_API_KEY",)),
        ("fireworks", ("FIREWORKS_API_KEY",)),
        ("deepseek", ("DEEPSEEK_API_KEY",)),
        ("openai.com", ("OPENAI_API_KEY",)),
    ):
        if needle in bl:
            for env in envs:
                if os.getenv(env):
                    return os.getenv(env)
    return None


def _make_llm(cfg: dict):
    if cfg.get("billing_url"):
        import anthropic as anthropic_sdk
        if cfg.get("provider") != "anthropic":
            raise ValueError("wallet_voice_llm_provider_not_configured")
        client = anthropic_sdk.AsyncAnthropic(base_url=cfg["billing_url"], api_key=os.environ["VOICE_WORKER_SECRET"], max_retries=0)
        return anthropic.LLM(model=cfg.get("model") or "claude-haiku-4-5", caching="ephemeral", client=client)
    """LLM: Anthropic (Claude, default). Un `base_url` usa el plugin
    OpenAI-COMPATIBLE como protocolo para un endpoint self-hosted (vLLM/Modal),
    no OpenAI la empresa."""
    base_url = cfg.get("base_url")
    if base_url:
        key = _llm_key(cfg)
        model_name = cfg.get("model") or "gpt-4o-mini"
        llm_kwargs = dict(
            base_url=base_url,
            api_key=key or _OAI_PLACEHOLDER_KEY,
            model=model_name,
        )
        # gpt-oss (Cerebras/Groq) es un modelo de *reasoning*: por defecto gasta
        # tokens razonando antes de responder → latencia y silencios en voz.
        # Forzamos reasoning mínimo. Sólo estos modelos aceptan el parámetro;
        # fail-soft si el plugin de esta versión no lo expone.
        if "gpt-oss" in model_name.lower():
            try:
                return openai.LLM(**llm_kwargs, reasoning_effort="low")
            except TypeError:
                logger.warning("openai.LLM no acepta reasoning_effort; sin él")
        return openai.LLM(**llm_kwargs)
    # caching="ephemeral" activa prompt caching de Anthropic (system + tools + historial).
    #
    # El timeout va explícito y holgado. El primer turno de una llamada ESCRIBE
    # la caché —system + las quince herramientas + el historial— y esa escritura
    # tarda bastante más que las lecturas que vienen después. Con el default
    # corto del plugin, ese primer turno se pasaba: «Request timed out», y el
    # cliente que acababa de decir lo que quería se quedaba escuchando silencio.
    # Visto en producción el 2026-08-28.
    kw = {"model": cfg.get("model") or "claude-haiku-4-5", "caching": "ephemeral"}
    try:
        return anthropic.LLM(
            **kw, timeout=float(os.getenv("VOICE_LLM_TIMEOUT_SECS", "25"))
        )
    except TypeError:
        # Una versión del plugin que no acepta `timeout` no puede costar la
        # llamada: se arma igual, con su default.
        logger.warning("anthropic.LLM no acepta timeout; sigo con el default")
        return anthropic.LLM(**kw)


def _make_tts(cfg: dict):
    if cfg.get("billing_url"):
        return openai.TTS(base_url=cfg["billing_url"], api_key=os.environ["VOICE_WORKER_SECRET"], model=cfg.get("model") or "s2-pro", voice=cfg.get("voice_id") or "default", response_format="mp3")

    """TTS por provider: elevenlabs (default) · fish · cartesia · google. Un
    `base_url` fuerza el plugin OpenAI-compatible (VoxCPM en Modal, etc.)."""
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
    provider = (cfg.get("provider") or "").lower()
    try:
        if provider == "deepgram":
            # Deepgram Aura-2 (voz "Celeste" español colombiano). Baja latencia y
            # usa la DEEPGRAM_API_KEY del entorno (ya presente en el worker).
            return deepgram.TTS(model=cfg.get("model") or "aura-2-celeste-es")
        if provider in ("fish", "fishaudio", "fish_audio"):
            from livekit.plugins import fishaudio

            # `voice_id` == `reference_id` de Fish. El contexto ya lo filtra por
            # formato; si no vino, el plugin usa su voz por defecto (no muda).
            f_kw: dict = {"model": cfg.get("model") or "s2.1-pro"}
            if cfg.get("voice_id"):
                f_kw["voice_id"] = cfg["voice_id"]
            key = cfg.get("api_key") or os.getenv("FISH_API_KEY") or os.getenv("FISH_AUDIO_API_KEY")
            if key:
                f_kw["api_key"] = key
            return fishaudio.TTS(**f_kw)
        if provider == "cartesia":
            from livekit.plugins import cartesia

            kw: dict = {"model": cfg.get("model") or "sonic-2"}
            if cfg.get("voice_id"):
                kw["voice"] = cfg["voice_id"]
            key = cfg.get("api_key") or os.getenv("CARTESIA_API_KEY")
            if key:
                kw["api_key"] = key
            return cartesia.TTS(**kw)
        if provider in ("gemini", "google"):
            from livekit.plugins import google

            g_kw: dict = {"model": cfg.get("model") or "gemini-2.5-flash-preview-tts"}
            if cfg.get("voice_id"):
                g_kw["voice_name"] = cfg["voice_id"]
            key = cfg.get("api_key") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if key:
                g_kw["api_key"] = key
            return google.TTS(**g_kw)
    except Exception:
        logger.warning("TTS provider '%s' no disponible; uso ElevenLabs", provider, exc_info=True)
    # ElevenLabs (default). Pasa la key EXPLÍCITA: el fallback por env del plugin
    # (ELEVEN_API_KEY) resultó poco fiable en el worker; así siempre la recibe.
    # Acá se cae también cuando OTRO proveedor falló al construirse, así que el
    # `model` del cfg puede ser de ese otro (s2.1-pro, sonic-2, aura-2-…): sólo
    # reenviamos el nombre si es de ElevenLabs, o el fallback también queda mudo.
    el_model = cfg.get("model") or ""
    el_kw: dict = {
        "model": el_model if el_model.startswith("eleven_") else "eleven_flash_v2_5",
        "api_key": cfg.get("api_key") or os.getenv("ELEVEN_API_KEY") or os.getenv("ELEVENLABS_API_KEY"),
    }
    # Mismo criterio con la voz: un reference_id de Fish (32 hex) no existe en
    # ElevenLabs. Sin voz válida omitimos el kwarg → el plugin usa la suya.
    el_voice = cfg.get("voice_id") or ""
    if el_voice and not re.fullmatch(r"[0-9a-fA-F]{32}", el_voice):
        el_kw["voice_id"] = el_voice
    return elevenlabs.TTS(**el_kw)


class RiverzAgent(Agent):
    """Agent con acento configurable.

    Cuando el backend marca `speech_style: "rioplatense"` (llamadas a números
    argentinos), el texto se reescribe fonéticamente JUSTO antes de sintetizar:
    `calle` → `cashe`, `yo` → `sho`. El TTS lee letras, así que ésa es la única
    palanca real para marcar el acento.

    Va acá y no en el prompt del LLM a propósito: la transcripción de la bandeja
    y el resumen de la llamada siguen en español normal. El comercio lee
    "Ya salió tu pedido", no "Sha salió tu pedido".
    """

    def __init__(self, *args, speech_style: str | None = None, lang: str = "es", **kwargs):
        super().__init__(*args, **kwargs)
        self._speech_style = speech_style
        self._lang = lang

    def tts_node(self, text, model_settings):  # noqa: ANN001
        # Orden: primero se saca lo que no se puede decir (links, viñetas,
        # emojis) y recién después se aplica el acento. Al revés, el ʃeísmo
        # entraría dentro de una URL y ya no se reconocería como tal.
        text = speakable_stream(text, self._lang)
        if self._speech_style == "rioplatense":
            text = sheismo_stream(text)
        return Agent.default.tts_node(self, text, model_settings)


# --- Red de seguridad en runtime ----------------------------------------------
# Elegir mal un modelo en /admin/voz no debería costar una llamada. El backend ya
# deja el stack coherente ANTES de que llegue acá (src/lib/voice/compat.ts), pero
# eso no cubre lo que pasa EN VIVO: sin saldo, un 500 del proveedor, una key
# vencida. Para eso cada capa va envuelta en el FallbackAdapter de LiveKit, con
# un respaldo que siempre tiene key en el worker: si la primaria falla a mitad de
# llamada, se cambia sola y sigue hablando en vez de quedarse muda.
#
# Respaldos: Deepgram (STT) · Anthropic (LLM) · ElevenLabs (TTS). Se omite el
# respaldo si su key no está, o si YA es el proveedor primario (no tendría a
# dónde caer). VOICE_DISABLE_FALLBACK=1 lo apaga entero.
_BACKUP_ENV = {
    "stt": ("DEEPGRAM_API_KEY",),
    "llm": ("ANTHROPIC_API_KEY",),
    "tts": ("ELEVENLABS_API_KEY", "ELEVEN_API_KEY"),
}


def _backup_for(layer: str, primary_provider: str | None = None):
    if layer == "stt":
        return deepgram.STT(model="nova-3", language="multi")
    if layer == "llm":
        # Con Anthropic de primaria, caer a Anthropic no es una red: es la misma
        # rama del árbol. Ahí el respaldo pasa a ser Groq, que tiene key en el
        # worker. Groq tiene un techo bajo de tokens por minuto en el plan
        # gratis, pero de respaldo eso alcanza: se usa por turnos sueltos, no
        # por la llamada entera.
        if (primary_provider or "").lower() == "anthropic":
            if os.getenv("GROQ_API_KEY"):
                # `openai/gpt-oss-120b`, NO `llama-3.3-70b-versatile`: esa no
                # existe en esta cuenta de Groq. Verificado contra
                # GET /openai/v1/models — el respaldo devolvía 404
                # `model_not_found` y la cadena entera moría con «all LLMs
                # failed», que en el teléfono suena a que el agente no escucha.
                # Si hay que cambiarlo, mirar primero qué modelos lista la API.
                return openai.LLM(
                    base_url="https://api.groq.com/openai/v1",
                    api_key=os.getenv("GROQ_API_KEY"),
                    model=os.getenv("VOICE_BACKUP_LLM_MODEL", "openai/gpt-oss-120b"),
                )
            raise RuntimeError("sin GROQ_API_KEY para respaldar a Anthropic")
        return anthropic.LLM(model="claude-haiku-4-5", caching="ephemeral")
    return elevenlabs.TTS(
        model="eleven_flash_v2_5",
        api_key=os.getenv("ELEVENLABS_API_KEY") or os.getenv("ELEVEN_API_KEY"),
    )


# Qué proveedor primario hace redundante al respaldo de cada capa.
_BACKUP_PROVIDER = {"stt": "deepgram", "llm": "anthropic", "tts": "elevenlabs"}


def _with_backup(layer: str, primary, context: dict):
    """Envuelve la capa en su FallbackAdapter. Fail-soft: cualquier problema
    armando el respaldo devuelve la primaria sola (peor es no tener nada)."""
    if os.getenv("VOICE_DISABLE_FALLBACK") == "1":
        return primary
    cfg = context.get("voice" if layer == "tts" else layer) or {}
    proveedor = (cfg.get("provider") or "").lower()
    # Con base_url la capa apunta a un endpoint propio (Modal); el proveedor
    # declarado no dice nada del servicio real, pero el respaldo igual sirve.
    #
    # El LLM es la excepción: cuando la primaria YA es el respaldo, en vez de
    # quedarse sin red se busca otra (ver `_backup_for`). Quedarse sin red en
    # la capa que piensa es justamente lo que deja al cliente hablando solo.
    if proveedor == _BACKUP_PROVIDER[layer] and not cfg.get("base_url") and layer != "llm":
        return primary
    if layer != "llm" and not any(os.getenv(v) for v in _BACKUP_ENV[layer]):
        logger.info("capa %s sin respaldo: falta %s", layer, "/".join(_BACKUP_ENV[layer]))
        return primary
    try:
        backup = _backup_for(layer, proveedor)
        adapter = {
            "stt": agents_stt.FallbackAdapter,
            "llm": agents_llm.FallbackAdapter,
            "tts": agents_tts.FallbackAdapter,
        }[layer]
        return adapter([primary, backup])
    except Exception:
        logger.warning("no se pudo armar el respaldo de %s", layer, exc_info=True)
        return primary


# Voces válidas de Gemini Live (native audio). El pipeline usa el voice_id de
# ElevenLabs/Deepgram, que Gemini NO entiende → si la voz configurada no es una
# de estas, caemos a una multilingüe natural. Override por env VOICE_GEMINI_VOICE.
_GEMINI_VOICES = {
    "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr",
}


def _gemini_voice(v) -> str:
    if v and v in _GEMINI_VOICES:
        return v
    env = os.getenv("VOICE_GEMINI_VOICE")
    if env and env in _GEMINI_VOICES:
        return env
    return "Aoede"  # multilingüe, natural en español


def _try_build_realtime(context: dict):
    """Construye un RealtimeModel speech-to-speech (full-duplex) desde
    context.realtime, o None → cae al pipeline.

    Rutea por provider (todos multilingües salvo PersonaPlex):
      - gemini_live/google → Gemini Live nativo (hosteado, multilingüe).
      - openai_realtime/openai → OpenAI Realtime nativo (hosteado, multilingüe).
      - personaplex/nvidia → self-host GPU (solo inglés, sin tools).
      - cualquiera con base_url → endpoint OpenAI-Realtime-COMPATIBLE self-hosted
        (Qwen-Omni en Modal/RunPod, Moshi, etc.). Es el camino "trae tu modelo".
    """
    rt = context.get("realtime") or {}
    provider = (rt.get("provider") or "").lower()
    base_url = rt.get("base_url")
    voice_id = (context.get("voice") or {}).get("voice_id")

    # PersonaPlex (self-host). No tiene function-calling → agentes con tools DEBEN
    # usar el pipeline para conservar create_order, etc.
    if provider in ("personaplex", "nvidia"):
        if context.get("tools_enabled"):
            logger.info("realtime=personaplex pero el agente usa tools; uso pipeline")
            return None
        try:
            from personaplex import build_personaplex_realtime

            return build_personaplex_realtime(context)
        except Exception:
            logger.warning("no se pudo construir PersonaPlex; uso pipeline", exc_info=True)
            return None

    # Gemini Live (Google) — full-duplex hosteado, multilingüe (habla español).
    if provider in ("gemini_live", "google"):
        try:
            from livekit.plugins import google

            g_kwargs: dict = {
                # Modelo Live de audio nativo. El default es un modelo REAL de la
                # familia native-audio; el nombre viejo "gemini-live-2.5-flash-preview"
                # NO existe y cerraba el WS con 1008 (no era falta de cuota).
                "model": rt.get("model") or "gemini-2.5-flash-native-audio-latest",
                # Voz: Gemini usa NOMBRES propios (Aoede, Kore, Puck…), NO el
                # voice_id de ElevenLabs/Deepgram del pipeline. Si la voz configurada
                # no es una válida de Gemini, cae a una multilingüe por defecto.
                "voice": _gemini_voice(rt.get("voice") or voice_id),
            }
            key = rt.get("api_key") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if key:
                g_kwargs["api_key"] = key
            return google.beta.realtime.RealtimeModel(**g_kwargs)
        except Exception:
            logger.warning("no se pudo construir Gemini Live; uso pipeline", exc_info=True)
            return None

    # Qwen-Omni (self-host RunPod/Modal): el server (runpod/qwen-omni) es
    # turn-based (audio→audio), NO habla el protocolo OpenAI-Realtime. Su adapter
    # LiveKit es el paso 2 (necesita GPU en el loop). Hasta entonces cae al
    # pipeline (Cerebras+Celeste) — nunca rompe la llamada.
    if provider in ("qwen_omni", "qwen-omni", "qwen"):
        logger.info("realtime=qwen_omni: adapter LiveKit pendiente; uso pipeline")
        return None

    # OpenAI Realtime NATIVO (sin base_url) o cualquier endpoint OpenAI-Realtime-
    # COMPATIBLE self-hosted vía base_url (Moshi u otro con ese contrato).
    try:
        from livekit.plugins.openai import realtime as openai_realtime

        kwargs: dict = {}
        if base_url:
            kwargs["base_url"] = base_url
            kwargs["api_key"] = rt.get("api_key") or _OAI_PLACEHOLDER_KEY
        else:
            key = rt.get("api_key") or os.getenv("OPENAI_API_KEY")
            if key:
                kwargs["api_key"] = key
        if rt.get("model"):
            kwargs["model"] = rt["model"]
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
    # Ajustes de latencia + interrupciones (barge-in natural):
    #  - allow_interruptions: el cliente PUEDE cortar al bot hablando.
    #  - min_interruption_words=2: hace falta hablar en serio para cortarlo (un
    #    "ajá"/ruido no lo interrumpe) → se siente humano sin falsos cortes.
    #  - min_endpointing_delay bajo: responde apenas detecta que terminaste.
    kwargs: dict = dict(
        stt=_with_backup("stt", _make_stt(context.get("stt") or {}), context),
        llm=_with_backup("llm", _make_llm(context.get("llm") or {}), context),
        tts=_with_backup("tts", _make_tts(context.get("voice") or {}), context),
        turn_detection=MultilingualModel(),
        vad=vad,
    )
    # Ajustes de LATENCIA (lo más cercano a full-duplex/PersonaPlex sin perder la
    # voz Celeste ni la inteligencia de Cerebras):
    #  - preemptive_generation: el bot empieza a generar la respuesta apenas
    #    detecta fin de turno probable (no espera la confirmación) → recorta el
    #    mayor pedazo de latencia percibida. Si sigue hablando, se descarta.
    #  - min_endpointing_delay 0.25: responde casi al instante tras que callas.
    #  - max_endpointing_delay 2.5: tope más corto para pausas largas.
    # Fallback EN CAPAS: si la versión no acepta preemptive_generation, se prueba
    # sin él (no perdemos el resto del tuning); si nada, sesión pelada.
    tuned = dict(
        allow_interruptions=True,
        min_interruption_words=2,
        min_endpointing_delay=0.25,
        max_endpointing_delay=2.5,
        preemptive_generation=True,
    )
    tuned_no_preempt = {k: v for k, v in tuned.items() if k != "preemptive_generation"}
    for attempt in (tuned, tuned_no_preempt, {}):
        try:
            return AgentSession(**kwargs, **attempt)
        except TypeError as e:
            logger.warning("AgentSession: retry sin unos params (%s)", e)
    return AgentSession(**kwargs)


async def _start_recording(ctx: JobContext, context: dict, call_state: CallState) -> bool:
    """Inicia LiveKit Egress (audio-only) de la room a un bucket S3-compatible
    (Supabase Storage vía endpoint S3). Fail-soft: si faltan credenciales o falla,
    loguea y NO graba, sin romper la llamada."""
    rec = context.get("recording") or {}
    if not rec.get("enabled"):
        return False
    bucket = os.getenv("RECORDING_S3_BUCKET")
    access = os.getenv("RECORDING_S3_ACCESS_KEY")
    secret = os.getenv("RECORDING_S3_SECRET_KEY")
    if not (bucket and access and secret):
        logger.warning("recording habilitado pero faltan credenciales S3; no se graba")
        return False
    endpoint = os.getenv("RECORDING_S3_ENDPOINT") or None
    region = os.getenv("RECORDING_S3_REGION") or "auto"
    # Key determinística por call_id (el bucket ya es "voice-recordings") -> el
    # backend firma la URL de reproducción como `<call_id>.ogg` sin adivinar.
    key = f"{call_state.call_id}.ogg"

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
        return bool(call_state.egress_id)
    except Exception:
        logger.warning("no se pudo iniciar egress; la llamada sigue sin grabación", exc_info=True)
        return False


async def _mailbox_notice(ctx: JobContext, language: str) -> None:
    encoded = MAILBOX_NOTICE_GZIP_BASE64["en" if language == "en" else "es"]
    pcm = gzip.decompress(base64.b64decode(encoded))
    source = rtc.AudioSource(8000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mailbox-disclosure", source)
    try:
        await ctx.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        for offset in range(0, len(pcm), 320):
            chunk = pcm[offset:offset+320]
            await source.capture_frame(rtc.AudioFrame(data=chunk, sample_rate=8000, num_channels=1, samples_per_channel=len(chunk)//2))
        await source.wait_for_playout()
    finally:
        await source.aclose()


async def _run_mailbox(ctx: JobContext, context: dict, call_state: CallState) -> None:
    async def record():
        # A failed transfer might have started the existing room recording.
        return bool(call_state.egress_id) or await _start_recording(ctx, context, call_state)
    def connected():
        customer = ctx.room.remote_participants.get(call_state.phone_identity)
        return customer is not None and getattr(customer, "kind", None) == 3 and (getattr(customer, "attributes", {}) or {}).get("sip.callStatus") == "active"
    def result_ready(result):
        # Set the outcome BEFORE delete_room can trigger the finalizer.
        call_state.outcome = "no_outcome"
        call_state.outcome_details = {**result, "fallback_reason": context["fallback"].get("reason")}
        call_state.status = "completed" if result["mailbox_capture"] == "recording_requested" else "failed"
    await capture_mailbox(
        policy=context["fallback"]["mailbox"], start_recording=record,
        play_notice=lambda: _mailbox_notice(ctx, context.get("language") or "es"),
        connected=connected, hangup=_hangup, result_ready=result_ready,
    )


async def _timeout_guard(session: AgentSession, context: dict, call_state: CallState) -> None:
    """Timeout duro: al superar max_call_seconds, despedida breve y colgar."""
    max_seconds = int(context.get("max_call_seconds") or 300)
    try:
        await asyncio.sleep(max_seconds)
    except asyncio.CancelledError:
        return
    logger.info("max_call_seconds (%s) alcanzado; cerrando llamada", max_seconds)
    try:
        if not call_state.human_handoff_pending:
            await session.say(_goodbye(context.get("language", "es")))
    except Exception:
        pass
    if call_state.status is None:
        call_state.status = "completed"
    await _hangup()


async def _silence_guard(session: AgentSession, context: dict, call_state: CallState) -> None:
    """Cuelga si el cliente deja de hablar. En dos tiempos: al acumular
    `silence_timeout_seconds` de silencio, un "¿sigues ahí?"; si sigue callado
    otro tramo igual, despedida breve y colgar. Cualquier turno (cliente o
    agente) reinicia el reloj, así no corta al agente mientras habla."""
    try:
        total = float(
            context.get("silence_timeout_seconds")
            or os.getenv("VOICE_SILENCE_TIMEOUT_SECS")
            or 8
        )
    except (TypeError, ValueError):
        total = 8.0
    if total <= 0:
        return
    # Arranca el reloj al iniciar la sesión (no colgar durante el setup).
    call_state.last_activity_at = time.monotonic()
    nudged_at = 0.0
    try:
        while True:
            await asyncio.sleep(1.0)
            if call_state.human_handoff_pending:
                return
            now = time.monotonic()

            # Mientras el agente habla o piensa, no hay silencio que medir.
            #
            # El reloj se refresca con `conversation_item_added`, que llega
            # cuando el modelo GENERA el turno — no cuando el TTS termina de
            # decirlo. Una respuesta larga tarda quince segundos en sonar, así
            # que a los ocho el guard disparaba «¿sigues ahí?» encima de la voz
            # del propio agente. Visto en la llamada del 2026-08-28: la frase se
            # pegó al final de su propia oferta, dos veces, y le preguntaba al
            # cliente si seguía ahí mientras el cliente esperaba que terminara
            # de hablar.
            estado = str(getattr(session, "agent_state", "") or "")
            if estado in ("speaking", "thinking", "initializing"):
                call_state.last_activity_at = now
                continue

            idle = now - (call_state.last_activity_at or now)
            # El cliente volvió a hablar tras el aviso -> reinicia el ciclo.
            if nudged_at and call_state.last_user_at > nudged_at:
                nudged_at = 0.0
            if idle < total:
                continue
            if not nudged_at:
                # Primer tramo de silencio: empujoncito (cuenta como turno del
                # agente y refresca last_activity_at vía el evento).
                nudged_at = now
                try:
                    await session.say(_still_there(context.get("language", "es")))
                except Exception:
                    pass
                continue
            break  # ya avisamos y siguió callado -> colgar
    except asyncio.CancelledError:
        return
    logger.info("silencio prolongado del cliente; despido y cuelgo")
    try:
        await session.say(_goodbye(context.get("language", "es")))
    except Exception:
        pass
    if call_state.status is None:
        call_state.status = "completed"
    await _hangup()


async def _deliver_greeting(session, context: dict) -> None:
    """Speak the opening line, tolerant of the engine.

    - Pipeline (STT→LLM→TTS): `session.say(greeting)` works.
    - Realtime (e.g. PersonaPlex): full-duplex S2S has no separate TTS and may
      not support say()/generate_reply — the model self-drives the greeting.
    Never throws: a greeting failure must not kill the call.
    """
    # ¿Habla primero el agente? Configurable por dirección (context.ts lo resuelve
    # según inbound/outbound). Si NO, no saludamos: esperamos a que hable el
    # cliente y el modelo responde a lo que diga (típico en entrantes: llamó él).
    if not context.get("agent_greets_first", True):
        return
    greeting = context.get("greeting")
    if not greeting:
        return
    # Delay opcional antes de que el agente hable: le da aire al cliente para
    # atender y ubicarse sin apuro. Tope de seguridad de 10 s.
    try:
        delay = float(context.get("greeting_delay_seconds") or 0)
        if delay > 0:
            await asyncio.sleep(min(delay, 10.0))
    except (TypeError, ValueError):
        pass
    if context.get("mode") == "realtime":
        # Try to nudge the model to greet; if unsupported, let it drive itself.
        try:
            handle = session.generate_reply(instructions=greeting)
            if handle is not None and hasattr(handle, "__await__"):
                await handle
            return
        except Exception:
            pass
        try:
            await session.say(greeting)
        except Exception:
            logger.info("realtime: sin say()/generate_reply; el modelo saluda solo")
        return
    try:
        await session.say(greeting)
    except Exception:
        logger.warning("no se pudo reproducir el saludo", exc_info=True)


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
    agent = RiverzAgent(
        speech_style=context.get("speech_style"),
        lang=context.get("language") or "es",
        instructions=context.get("system_prompt", ""),
        tools=build_tools(
            call_state=call_state,
            api=api,
            tools_enabled=context.get("tools_enabled") or [],
            tool_specs=context.get("tools") or [],
            transfer_number=(context.get("transfer") or {}).get("number"),
        ),
    )

    # El reporte de resultado se hace SIEMPRE en el shutdown (guardado por flag).
    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context, lk_api=ctx.api))

    # Arranca la sesión en paralelo mientras marcamos (patrón del ejemplo oficial).
    session_task = _spawn(
        session.start(agent=agent, room=ctx.room, room_input_options=_room_input_options(context.get("human_handoff_enabled") is True))
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
    ring_timeout = _duration(RING_TIMEOUT_SECS)
    if ring_timeout is not None:
        req_kwargs["ringing_timeout"] = ring_timeout

    last_error: Exception | None = None
    last_code = None
    for attempt in range(1, max(DIAL_ATTEMPTS, 1) + 1):
        try:
            # NOTE: create_sip_participant + wait_until_answered lanza TwirpError con
            # metadata['sip_status_code'] al fallar el marcado:
            # https://docs.livekit.io/sip/outbound-calls/
            await ctx.api.sip.create_sip_participant(lkapi.CreateSIPParticipantRequest(**req_kwargs))
            last_error = None
            break
        except lkapi.TwirpError as e:
            last_error, last_code = e, _sip_status_code(e)
            if last_code not in _RETRYABLE_SIP_STATUS or attempt >= max(DIAL_ATTEMPTS, 1):
                break
            logger.warning(
                "marcado rebotó con %s (intento %s/%s); reintento en %ss",
                last_code, attempt, DIAL_ATTEMPTS, DIAL_RETRY_DELAY_SECS,
            )
            # El participante fallido puede quedar colgando en la sala y chocar con
            # el reintento por identity repetida; lo sacamos antes (fail-soft).
            try:
                await ctx.api.room.remove_participant(
                    lkapi.RoomParticipantIdentity(room=ctx.room.name, identity=identity)
                )
            except Exception:
                pass
            await asyncio.sleep(DIAL_RETRY_DELAY_SECS)

    if last_error is not None:
        call_state.status = (
            "capacity_limited" if _is_capacity_limit(last_error)
            else "no_answer" if last_code is None and _is_ring_timeout(last_error)
            else _map_sip_status(last_code)
        )
        logger.warning(
            "fallo al marcar SIP: %s (status %s, %s intentos)",
            getattr(last_error, "message", last_error), last_code, attempt,
        )
        await _finalize(
            api, call_state, usage_collector, context,
            error=f"sip:{last_code}:{getattr(last_error, 'message', '')}",
        )
        ctx.shutdown()
        return

    # Contestaron.
    call_state.answered_at = _now_iso()
    # Grabación (si está habilitada) una vez que hay audio en la room.
    await _start_recording(ctx, context, call_state)
    await session_task

    await _deliver_greeting(session, context)

    _spawn(_timeout_guard(session, context, call_state))
    _spawn(_silence_guard(session, context, call_state))
    if context.get("human_handoff_enabled") is True:
        control = _spawn(control_human_handoff(
            api=api, session=session, call_state=call_state, room=ctx.room, hangup=_hangup,
        ))
        async def stop_human_control(*_):
            control.cancel()
            try:
                await control
            except asyncio.CancelledError:
                pass
        ctx.add_shutdown_callback(stop_human_control)



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

    participant_identity = getattr(participant, "identity", "") or ""
    # Exact identity of the physical SIP leg. Two real simultaneous calls from
    # the same phone must produce two records; a reconnect of the same leg must
    # reuse one. Caller + a two-minute window cannot tell those cases apart.
    session_id = f"{ctx.room.name}:{participant_identity}" if participant_identity else None
    context = await api.get_context(did=did, caller=caller, session_id=session_id)
    call_state.call_id = context.get("call_id", "")
    call_state.answered_at = _now_iso()
    # El participante telefónico ya está en la room -> guardamos su identity para transferir.
    call_state.phone_identity = participant_identity

    if context.get("mode") == "fallback":
        fallback = context.get("fallback") or {}
        transfer_number = fallback.get("transfer_number")
        transfer_rejected = False
        # This path never invokes an LLM or TTS provider. The fixed 8 kHz PCM
        # notice is embedded in the worker image and published straight into
        # the room before SIP REFER.
        ctx.add_shutdown_callback(
            lambda *_: _finalize(api, call_state, None, context, lk_api=ctx.api)
        )
        if not transfer_number and fallback.get("mailbox"):
            await _run_mailbox(ctx, context, call_state)
            return
        await _start_recording(ctx, context, call_state)
        try:
            language = "en" if context.get("language") == "en" else "es"
            encoded = FALLBACK_NOTICE_GZIP_BASE64[language]
            pcm = gzip.decompress(base64.b64decode(encoded))
            sample_rate = 8000
            channels = 1
            source = rtc.AudioSource(sample_rate, channels)
            track = rtc.LocalAudioTrack.create_audio_track("fallback-notice", source)
            await ctx.room.local_participant.publish_track(
                track,
                rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
            )
            chunk_bytes = (sample_rate // 50) * 2
            for offset in range(0, len(pcm), chunk_bytes):
                chunk = pcm[offset : offset + chunk_bytes]
                if len(chunk) % 2:
                    chunk += b"\0"
                await source.capture_frame(
                    rtc.AudioFrame(
                        data=chunk,
                        sample_rate=sample_rate,
                        num_channels=channels,
                        samples_per_channel=len(chunk) // 2,
                    )
                )
            await source.wait_for_playout()
        except Exception:
            logger.warning("no se pudo reproducir el aviso de fallback", exc_info=True)

        if transfer_number:
            try:
                await ctx.api.sip.transfer_sip_participant(
                    lkapi.TransferSIPParticipantRequest(
                        room_name=ctx.room.name,
                        participant_identity=participant_identity,
                        transfer_to=f"tel:{transfer_number}",
                    )
                )
                call_state.outcome = "transferred"
                call_state.outcome_details = {
                    "transferred": True,
                    "transfer_to": transfer_number,
                    "fallback_reason": fallback.get("reason"),
                }
                call_state.status = "completed"
                logger.info("fallback entrante transferido")
                return
            except Exception as exc:
                transfer_rejected = transfer_definitively_rejected(exc)
                call_state.status = "failed"
                call_state.outcome_details = {
                    "transferred": False,
                    "transfer_to": transfer_number,
                    "fallback_reason": fallback.get("reason"),
                    "error": "transfer_failed",
                }
                logger.warning("falló la transferencia de fallback: %s", exc)
        else:
            call_state.status = "failed"
            call_state.outcome_details = {
                "transferred": False,
                "fallback_reason": fallback.get("reason"),
                "error": "fallback_number_missing",
            }

        if fallback.get("mailbox") and transfer_rejected:
            await _run_mailbox(ctx, context, call_state)
            return

        await _hangup()
        return

    await _run_connected_ai(ctx, api, call_state, vad, context)


async def _run_connected_ai(ctx, api, call_state, vad, context):
    session = _build_session(context, vad)
    usage_collector = metrics.UsageCollector()
    _wire_events(session, call_state, usage_collector)
    agent = RiverzAgent(
        speech_style=context.get("speech_style"),
        lang=context.get("language") or "es",
        instructions=context.get("system_prompt", ""),
        tools=build_tools(
            call_state=call_state,
            api=api,
            tools_enabled=context.get("tools_enabled") or [],
            tool_specs=context.get("tools") or [],
            transfer_number=(context.get("transfer") or {}).get("number"),
        ),
    )
    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context, lk_api=ctx.api))
    # Grabación (si está habilitada).
    await _start_recording(ctx, context, call_state)

    await session.start(agent=agent, room=ctx.room, room_input_options=_room_input_options(context.get("human_handoff_enabled") is True))

    await _deliver_greeting(session, context)

    _spawn(_timeout_guard(session, context, call_state))
    _spawn(_silence_guard(session, context, call_state))
    if context.get("human_handoff_enabled") is True:
        control = _spawn(control_human_handoff(
            api=api, session=session, call_state=call_state, room=ctx.room, hangup=_hangup,
        ))
        async def stop_human_control(*_):
            control.cancel()
            try:
                await control
            except asyncio.CancelledError:
                pass
        ctx.add_shutdown_callback(stop_human_control)



async def _run_whatsapp(ctx, api, call_state, vad, meta):
    call_state.call_id = meta.get("call_id", "")
    call_state.phone_identity = f"whatsapp-{call_state.call_id}"

    async def disconnect():
        # A finalizer may already have closed the transcript client. Cleanup
        # owns a fresh client so every shutdown order can still end this leg.
        closer = RiverzAPI()
        try:
            return await closer.whatsapp_call("end", call_state.call_id, ctx.room.name, call_state.phone_identity)
        finally:
            await closer.aclose()

    set_whatsapp_disconnect(disconnect)
    async def end_connector(*_):
        try:
            await disconnect()
        except Exception:
            logger.warning("WhatsApp final cleanup uncertain")
    ctx.add_shutdown_callback(end_connector)
    context = await api.get_context(call_id=call_state.call_id)
    call_state.direction = (context.get("transport") or {}).get("direction", "outbound")

    async def observe(call_id, room, identity):
        return await api.whatsapp_call("observe", call_id, room, identity)

    try:
        transport, participant = await wait_for_whatsapp_customer(
            wait_participant=ctx.wait_for_participant, observe=observe,
            context=context, meta=meta, room_name=ctx.room.name,
        )
    except asyncio.TimeoutError:
        call_state.status = "no_answer"
        await _finalize(api, call_state, None, context)
        await _hangup()
        ctx.shutdown()
        return
    call_state.direction = transport["direction"]
    call_state.phone_identity = participant.identity
    call_state.answered_at = _now_iso()

    await _run_connected_ai(ctx, api, call_state, vad, context)


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
        if meta and meta.get("transport") == "whatsapp":
            await _run_whatsapp(ctx, api, call_state, vad, meta)
        elif meta:  # saliente: hay call_id en el metadata
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
        if meta and meta.get("transport") == "whatsapp":
            await _hangup()
            ctx.shutdown()
    # En el flujo normal el cliente HTTP se cierra dentro de _finalize, que corre
    # como shutdown callback cuando termina la llamada (así sigue vivo hasta el POST).


def prewarm(proc) -> None:
    """Precarga pesos pesados una vez por proceso (VAD)."""
    proc.userdata["vad"] = silero.VAD.load()


_HEARTBEAT_SECS = 60


def _heartbeat_loop() -> None:
    """Avisa cada minuto que este worker sigue vivo.

    Nadie puede sondear este proceso: no tiene puerto, y `dispatchVoiceCall`
    del lado del web tiene ÉXITO aunque no haya un solo worker conectado
    (LiveKit encola el trabajo y espera). El resultado era que la pantalla de
    Llamadas decía «listo», el cron despachaba, la llamada quedaba en `dialing`
    y veinte minutos después el barrido la cerraba como `worker_timeout`.

    El latido es lo único que distingue «no hay llamadas» de «no hay quien las
    tome». Se escribe con el cliente SÍNCRONO a propósito: `cli.run_app` es
    dueño del event loop de los agentes, y un hilo que le meta tareas puede
    tumbar una llamada en curso. Hilo daemon, así que muere con el proceso —
    que es exactamente la señal que queremos.
    """
    base = (os.getenv("RIVERZ_BASE_URL") or "").rstrip("/")
    secret = os.getenv("VOICE_WORKER_SECRET") or ""
    if not base or not secret:
        logger.warning("sin RIVERZ_BASE_URL/VOICE_WORKER_SECRET: no hay latido")
        return
    url = f"{base}/api/internal/voice/heartbeat"
    headers = {"Authorization": f"Bearer {secret}"}
    while True:
        try:
            with httpx.Client(timeout=10.0) as c:
                c.post(url, headers=headers)
        except Exception as e:
            # Un latido que se cae nunca puede llevarse el worker puesto: sin
            # llamadas que atender, el proceso vale más vivo que avisando.
            logger.warning("latido falló: %s", e)
        time.sleep(_HEARTBEAT_SECS)


if __name__ == "__main__":
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    # agent_name -> el worker sólo corre por dispatch explícito (salientes) y
    # recibe entrantes vía dispatch rule SIP apuntando a este mismo nombre.
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
        )
    )
