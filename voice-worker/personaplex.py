"""PersonaPlex (NVIDIA full-duplex speech-to-speech) realtime adapter.

Thin wrapper over the OFFICIAL `livekit-plugins-nvidia[personaplex]` RealtimeModel
(`livekit.plugins.nvidia.experimental.realtime.RealtimeModel`). NVIDIA + LiveKit
already ship the custom RealtimeModel/RealtimeSession that bridges LiveKit <-> the
PersonaPlex moshi-server binary WebSocket (mic frames in, Opus audio + text out,
barge-in). We only feed it context (base_url / voice / persona) and optional auth.

LIMITATIONS (structural, from the model — see /admin/voz + _try_build_realtime gate):
  * NO function/tool calling. `create_order`, `transfer_to_human`, etc. do NOT work
    in full-duplex S2S. Agents whose tools_enabled is non-empty MUST use the
    STT->LLM->TTS pipeline instead (enforced in agent.py::_try_build_realtime).
  * No customer-side transcription in realtime mode → the saved transcript is
    assistant-only.

Served by modal/personaplex.py (moshi.server on a warm GPU). Dormant until that
endpoint is deployed and the admin points the realtime layer at it.
"""
from __future__ import annotations

import logging
from urllib.parse import quote

logger = logging.getLogger("riverz-voice")

# The 18 PersonaPlex voices (natural / variety, F/M).
_PP_VOICES = {
    "NATF0", "NATF1", "NATF2", "NATF3", "NATM0", "NATM1", "NATM2", "NATM3",
    "VARF0", "VARF1", "VARF2", "VARF3", "VARF4",
    "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
}
_DEFAULT_VOICE = "NATF2"


def _map_voice(voice_id: str | None) -> str:
    if voice_id and voice_id.upper() in _PP_VOICES:
        return voice_id.upper()
    return _DEFAULT_VOICE


def build_personaplex_realtime(context: dict):
    """Build a PersonaPlex RealtimeModel from context.realtime, or None -> pipeline."""
    rt = context.get("realtime") or {}
    base_url = rt.get("base_url")
    if not base_url:
        return None
    try:
        # requires: pip install "livekit-plugins-nvidia[personaplex]"
        from livekit.plugins.nvidia.experimental.realtime import (  # type: ignore
            RealtimeModel as _PPModel,
            RealtimeSession as _PPSession,
        )
    except Exception:
        logger.warning(
            "livekit-plugins-nvidia[personaplex] no instalado; uso pipeline", exc_info=True
        )
        return None

    api_key = rt.get("api_key")
    voice = _map_voice((context.get("voice") or {}).get("voice_id"))
    text_prompt = context.get("system_prompt") or "You are a helpful assistant."

    # The stock plugin sends no auth. If an app-layer token is configured, append
    # it as a query param (a thin Modal proxy can validate ?auth_token=).
    class _AuthedSession(_PPSession):  # type: ignore[misc, valid-type]
        def __init__(self, realtime_model):
            self._riverz_auth = api_key  # set BEFORE super() (which starts the WS task)
            super().__init__(realtime_model)

        def _build_ws_url(self) -> str:
            url = super()._build_ws_url()
            if self._riverz_auth:
                sep = "&" if "?" in url else "?"
                url = f"{url}{sep}auth_token={quote(self._riverz_auth)}"
            return url

    class _RiverzPersonaPlex(_PPModel):  # type: ignore[misc, valid-type]
        def session(self):
            sess = _AuthedSession(self)
            try:
                self._sessions.add(sess)
            except Exception:
                pass
            return sess

    try:
        return _RiverzPersonaPlex(
            base_url=base_url,  # e.g. "wss://<workspace>--personaplex.modal.run"
            voice=voice,
            text_prompt=text_prompt,
        )
    except Exception:
        logger.warning("no se pudo construir PersonaPlex RealtimeModel; uso pipeline", exc_info=True)
        return None
