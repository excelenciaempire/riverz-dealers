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
        key = llm_cfg.get("api_key") or _OAI_PLACEHOLDER_KEY
        model = llm_cfg.get("model") or "llama-3.3-70b-versatile"
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(base_url=base_url, api_key=key)
            resp = await client.chat.completions.create(
                model=model, max_tokens=200,
                messages=[{"role": "user", "content": prompt}],
            )
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
        client = anthropic_sdk.AsyncAnthropic(api_key=key)
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


def _make_llm(cfg: dict):
    """LLM: Anthropic (Claude, default). Un `base_url` usa el plugin
    OpenAI-COMPATIBLE como protocolo para un endpoint self-hosted (vLLM/Modal),
    no OpenAI la empresa."""
    base_url = cfg.get("base_url")
    if base_url:
        # La key puede venir en la config (cifrada) o, si no, de una env var del
        # worker según el host (así no hay que meter la key en la DB). Cerebras =
        # Llama ultra-rápido (~2-3x Groq), API OpenAI-compatible.
        key = cfg.get("api_key")
        if not key:
            bl = base_url.lower()
            if "cerebras" in bl:
                key = os.getenv("CEREBRAS_API_KEY")
            elif "groq" in bl:
                key = os.getenv("GROQ_API_KEY")
            elif "googleapis" in bl:  # Gemini vía endpoint OpenAI-compatible
                key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            elif "deepinfra" in bl:
                key = os.getenv("DEEPINFRA_API_KEY")
            elif "together" in bl:
                key = os.getenv("TOGETHER_API_KEY")
            elif "fireworks" in bl:
                key = os.getenv("FIREWORKS_API_KEY")
            elif "deepseek" in bl:
                key = os.getenv("DEEPSEEK_API_KEY")
            elif "openai.com" in bl:
                key = os.getenv("OPENAI_API_KEY")
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
    return anthropic.LLM(
        model=cfg.get("model") or "claude-haiku-4-5",
        caching="ephemeral",
    )


def _make_tts(cfg: dict):
    """TTS por provider: elevenlabs (default) · cartesia · google. Un `base_url`
    fuerza el plugin OpenAI-compatible (VoxCPM en Modal, etc.)."""
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
    return elevenlabs.TTS(
        voice_id=cfg.get("voice_id"),
        model=cfg.get("model", "eleven_flash_v2_5"),
        api_key=cfg.get("api_key") or os.getenv("ELEVEN_API_KEY") or os.getenv("ELEVENLABS_API_KEY"),
    )


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

            g_kwargs: dict = {}
            if rt.get("model"):
                g_kwargs["model"] = rt["model"]
            if voice_id:
                g_kwargs["voice"] = voice_id
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
        stt=_make_stt(context.get("stt") or {}),
        llm=_make_llm(context.get("llm") or {}),
        tts=_make_tts(context.get("voice") or {}),
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


async def _deliver_greeting(session, context: dict) -> None:
    """Speak the opening line, tolerant of the engine.

    - Pipeline (STT→LLM→TTS): `session.say(greeting)` works.
    - Realtime (e.g. PersonaPlex): full-duplex S2S has no separate TTS and may
      not support say()/generate_reply — the model self-drives the greeting.
    Never throws: a greeting failure must not kill the call.
    """
    greeting = context.get("greeting")
    if not greeting:
        return
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
    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context, lk_api=ctx.api))

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
            "no_answer" if last_code is None and _is_ring_timeout(last_error)
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

    ctx.add_shutdown_callback(lambda *_: _finalize(api, call_state, usage_collector, context, lk_api=ctx.api))

    # Grabación (si está habilitada).
    await _start_recording(ctx, context, call_state)

    await session.start(agent=agent, room=ctx.room, room_input_options=_room_input_options())

    await _deliver_greeting(session, context)

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
