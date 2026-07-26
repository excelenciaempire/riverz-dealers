"""Cliente WebSocket para `moshi.server` (Kyutai Moshi / NVIDIA PersonaPlex),
el motor full-duplex que servimos en Modal.

Protocolo verificado contra kyutai-labs/moshi (moshi/moshi/server.py):
  - Ruta:        wss://<host>/api/chat
  - Handshake:   al conectar, el servidor envía UN byte  b"\\x00"  (ready).
  - Framing:     cada mensaje binario es  tag_byte + payload:
                   0x00 = handshake
                   0x01 = audio  (Opus, vía la librería `sphn`)
                   0x02 = texto  (tokens UTF-8, sólo server -> client)
  - Audio:       Opus streaming a la tasa de Mimi = 24 kHz, mono, float32
                 en la frontera de sphn.

Este cliente habla int16 PCM en sus bordes (lo que produce Pipecat tras el
serializer de Telnyx) y hace la conversión int16<->float32 internamente. El
resampleo 8k<->24k lo hace el bridge (moshi_bridge.py), no este cliente.

NOTA: los nombres de método de `sphn` (append_pcm/read_bytes, append_bytes/
read_pcm) son los del cliente de referencia de Kyutai; si tu versión de sphn
difiere, ajústalos aquí — es el único punto acoplado a esa librería.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import numpy as np
import sphn
import websockets

logger = logging.getLogger("riverz-pipecat.moshi")

HANDSHAKE = 0x00
TAG_AUDIO = 0x01
TAG_TEXT = 0x02
MIMI_SAMPLE_RATE = 24000  # tasa del códec Mimi que usan Moshi/PersonaPlex


class MoshiClient:
    """Una conexión = una conversación (moshi.server serializa una por worker)."""

    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        voice: str = "NATF2",
        text_prompt: str = "You are a helpful assistant.",
    ) -> None:
        self._base_url = base_url
        self._auth_token = auth_token
        # PersonaPlex exige voice_prompt (archivo .pt de embeddings en la carpeta
        # voices) y text_prompt en el query de /api/chat; sin ellos handle_chat
        # lanza KeyError y cierra el WS (1000) sin handshake.
        v = voice if voice.endswith(".pt") else f"{voice}.pt"
        self._voice_prompt = v
        self._text_prompt = text_prompt or "You are a helpful assistant."
        self._ws: websockets.WebSocketClientProtocol | None = None
        # `ready` = handshake recibido. NO enviar audio antes: el server carga los
        # prompts (voz/texto) durante varios segundos y recién ahí crea su
        # opus_reader; si le mandamos Opus durante esa ventana, su decoder muere
        # ('sending on a closed channel') y cierra la conexión (close 1000, msgs=2).
        # Esta era la diferencia con el probe, que espera el handshake antes de enviar.
        self.ready = False
        self._writer = sphn.OpusStreamWriter(MIMI_SAMPLE_RATE)
        self._reader = sphn.OpusStreamReader(MIMI_SAMPLE_RATE)

    def _chat_url(self) -> str:
        """wss://host/api/chat?voice_prompt=<voz>.pt&text_prompt=…[&auth_id=…]"""
        from urllib.parse import quote

        base, _, query = self._base_url.partition("?")
        base = base.rstrip("/")
        if not base.endswith("/api/chat"):
            base = f"{base}/api/chat"
        params = [p for p in query.split("&") if p]
        params.append(f"voice_prompt={quote(self._voice_prompt)}")
        params.append(f"text_prompt={quote(self._text_prompt)}")
        if self._auth_token:
            params.append(f"auth_id={quote(self._auth_token)}")
        return base + "?" + "&".join(params)

    async def connect(self, timeout: float = 60.0) -> None:
        url = self._chat_url()
        logger.info("moshi: conectando a %s", url.split("?")[0])
        # compression=None: el server de moshi es aiohttp; permessage-deflate del
        # cliente `websockets` puede romper la entrega de frames binarios (Opus).
        # ping_interval/timeout bajos: el contenedor de Modal puede ser DESALOJADO
        # (preemption) a media llamada y dejar el socket medio-abierto. Con el ping
        # por defecto (20s) una llamada corta nunca detecta al peer muerto → audio
        # a la nada. Con 5s, la caída se detecta en ~5-8s y el supervisor reconecta.
        self._ws = await websockets.connect(
            url,
            max_size=None,
            open_timeout=timeout,
            compression=None,
            ping_interval=5,
            ping_timeout=8,
        )
        # El servidor envía el byte de handshake antes del loop de audio.
        try:
            msg = await asyncio.wait_for(self._ws.recv(), timeout=timeout)
            if isinstance(msg, (bytes, bytearray)) and msg and msg[0] != HANDSHAKE:
                logger.warning("moshi: primer mensaje no fue handshake (tag=%s)", msg[0])
            # Handshake OK → recién ahora es seguro enviar audio.
            self.ready = True
        except asyncio.TimeoutError:
            logger.warning("moshi: sin handshake dentro de %.0fs (sigo igual)", timeout)
            self.ready = True  # fail-soft: igual intentamos enviar

    async def send_pcm(self, pcm16_24k: bytes) -> None:
        """Envía audio del usuario (PCM int16 mono a 24 kHz) al modelo."""
        if not self._ws or not self.ready:
            return
        try:
            pcm = np.frombuffer(pcm16_24k, dtype=np.int16).astype(np.float32) / 32768.0
            self._writer.append_pcm(pcm)
            # Drená todo el Opus disponible (el encoder bufferea; un solo
            # read_bytes por chunk puede no emitir nada).
            while True:
                opus = self._writer.read_bytes()
                if not opus:
                    break
                await self._ws.send(bytes([TAG_AUDIO]) + opus)
        except Exception as e:  # fail-soft: un frame perdido no tumba la llamada
            logger.debug("moshi send_pcm error: %s", e)

    async def recv_loop(
        self,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_text: Callable[[str], Awaitable[None]] | None = None,
    ) -> None:
        """Consume el stream del modelo hasta que se cierre el WS.
        `on_audio` recibe PCM int16 mono a 24 kHz; `on_text` los tokens."""
        if not self._ws:
            return
        _msgs = 0
        try:
            async for message in self._ws:
                if isinstance(message, str) or not message:
                    continue
                _msgs += 1
                tag, payload = message[0], message[1:]
                if tag == TAG_AUDIO:
                    try:
                        self._reader.append_bytes(payload)
                        # Drená TODO el PCM disponible (el decoder Opus bufferea;
                        # un solo read_pcm por frame pierde audio) — igual que el
                        # opus_loop del server (read_pcm hasta shape[-1]==0).
                        while True:
                            pcm = self._reader.read_pcm()
                            if pcm is None or pcm.shape[-1] == 0:
                                break
                            pcm16 = (np.clip(pcm, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
                            await on_audio(pcm16)
                    except Exception as e:
                        logger.debug("moshi decode error: %s", e)
                        continue
                elif tag == TAG_TEXT and on_text is not None:
                    try:
                        text = payload.decode("utf-8", errors="ignore")
                    except Exception:
                        text = ""
                    if text:
                        await on_text(text)
        except websockets.ConnectionClosed as e:
            logger.info("moshi: conexión cerrada (msgs=%d, %s)", _msgs, e)
        except Exception as e:
            logger.warning("moshi recv_loop error (msgs=%d): %s", _msgs, e)
        else:
            # `async for` terminó sin excepción = el server cerró el WS. Registrar
            # el código/razón de cierre para ubicar POR QUÉ cae en la llamada real.
            cc = getattr(self._ws, "close_code", None)
            cr = getattr(self._ws, "close_reason", None)
            logger.warning(
                "moshi: recv_loop terminó sin datos útiles (msgs=%d, close_code=%s, reason=%r)",
                _msgs, cc, cr,
            )

    async def close(self) -> None:
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
