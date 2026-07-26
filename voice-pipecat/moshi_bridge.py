"""`MoshiBridge` — un FrameProcessor de Pipecat que conecta el audio de la
llamada (Telnyx) con un modelo full-duplex speech-to-speech (Moshi/PersonaPlex)
servido por WebSocket en Modal. SIN LiveKit.

Se coloca como el único nodo de audio del pipeline:

    Pipeline([ transport.input(),  MoshiBridge(...),  transport.output() ])

- Entra `InputAudioRawFrame` (PCM int16 a la tasa del pipeline) -> resampleo a
  24 kHz -> se envía al modelo por su WS.
- El modelo devuelve audio 24 kHz -> resampleo a la tasa de salida ->
  `OutputAudioRawFrame` hacia el transport (que el serializer de Telnyx
  convierte a PCMU 8 kHz para el teléfono).

El modelo se auto-conduce (full-duplex): NO hay say()/generate_reply con guion,
por eso no montamos STT/LLM/TTS. El saludo lo produce el propio modelo según su
voz/prompt configurados en el servidor.

Verificado contra pipecat main (2026-07-25): base `FrameProcessor`, frames
`InputAudioRawFrame`/`OutputAudioRawFrame` (PCM int16 LE mono; campos audio/
sample_rate/num_channels), resampleo con `create_stream_resampler`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from pipecat.audio.utils import create_stream_resampler
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    OutputAudioRawFrame,
    StartFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from moshi_client import MIMI_SAMPLE_RATE, MoshiClient

logger = logging.getLogger("riverz-pipecat.bridge")


class MoshiBridge(FrameProcessor):
    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        voice: str = "NATF2",
        text_prompt: str = "You are a helpful assistant.",
        on_transcript: Callable[[str, str], None] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self._url = base_url
        self._auth = auth_token
        self._voice = voice
        self._text_prompt = text_prompt
        self._on_transcript = on_transcript
        self._client: MoshiClient | None = None
        self._supervisor_task: asyncio.Task | None = None
        self._active = False
        self._up = create_stream_resampler()   # entrada  pipeline_rate -> 24k
        self._down = create_stream_resampler()  # salida   24k -> out_rate
        self._out_rate = 8000
        # moshi/Mimi opera en frames de 80ms = 1920 muestras @24k = 3840 bytes.
        # Telnyx entrega 20ms (¼ de frame Mimi); mandar cuartos de frame hace que
        # el modelo NO dé pasos → 0 audio de vuelta (probado: el probe manda 80ms y
        # SÍ responde). Bufferizamos la entrada y enviamos en bloques de 80ms.
        self._MIMI_CHUNK = 1920 * 2  # bytes de PCM int16 @24k por frame de 80ms
        self._in_buf = bytearray()
        # Instrumentación: contar frames de entrada (Telnyx->moshi) y de salida
        # (moshi->Telnyx) para ubicar dónde se corta el audio en la llamada real.
        self._in_n = 0
        self._in_bytes = 0
        self._out_n = 0
        self._out_bytes = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        # OBLIGATORIO: la base maneja Start/End/Cancel/interrupciones.
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            self._out_rate = getattr(frame, "audio_out_sample_rate", None) or 8000
            # Empuja StartFrame PRIMERO (que el pipeline arranque) y conecta a
            # moshi en segundo plano; si bloqueáramos aquí, el transport de
            # salida nunca recibe StartFrame.
            await self.push_frame(frame, direction)
            self._active = True
            self._supervisor_task = asyncio.create_task(self._supervise())
        elif isinstance(frame, (EndFrame, CancelFrame)):
            await self._stop()
            await self.push_frame(frame, direction)
        elif isinstance(frame, InputAudioRawFrame):
            await self._forward_input(frame)
            # No re-empujamos el input: la salida la produce el modelo.
        else:
            await self.push_frame(frame, direction)

    async def _supervise(self) -> None:
        """Mantiene viva la conexión a moshi durante toda la llamada. Modal puede
        DESALOJAR (preemption) el contenedor a media llamada; cuando el WS cae,
        recv_loop retorna → reconectamos a otro contenedor caliente (min_containers
        >= 2) y el audio se reanuda en ~pocos segundos, en vez de quedar mudo.
        Se pierde el estado conversacional de moshi al reconectar (es full-duplex
        stateful), aceptable para un recepcionista: mejor que dead air."""
        attempt = 0
        while self._active:
            try:
                self._client = MoshiClient(
                    self._url, self._auth, voice=self._voice, text_prompt=self._text_prompt
                )
                await self._client.connect()
                logger.info(
                    "MoshiBridge activo (voice=%s out_rate=%d intento=%d)",
                    self._voice, self._out_rate, attempt,
                )
                attempt = 0
                # recv_loop bloquea hasta que el WS se cierra (o el peer muere y el
                # ping lo detecta). Cuando retorna, la conexión ya no sirve.
                await self._client.recv_loop(self._emit_audio, self._emit_text)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.error("MoshiBridge conexión a moshi falló: %s", e)
            finally:
                if self._client:
                    await self._client.close()
                    self._client = None
            if not self._active:
                break
            attempt += 1
            if attempt > 8:
                logger.error("MoshiBridge: demasiados reintentos a moshi; me rindo")
                break
            logger.warning("MoshiBridge: moshi caído; reconectando (intento %d)…", attempt)
            await asyncio.sleep(min(0.4 * attempt, 2.0))

    async def _forward_input(self, frame: InputAudioRawFrame) -> None:
        if not self._client:
            return
        try:
            # Amplitud de la ENTRADA cruda de Telnyx: distingue "el llamante habla"
            # de "llega silencio" (Telnyx no enruta el audio entrante). Pico por
            # ventana de logging.
            try:
                import numpy as _np
                peak = int(_np.abs(_np.frombuffer(frame.audio, dtype=_np.int16)).max()) if frame.audio else 0
                self._in_peak = max(getattr(self, "_in_peak", 0), peak)
            except Exception:
                pass
            pcm24 = await self._up.resample(frame.audio, frame.sample_rate, MIMI_SAMPLE_RATE)
            if pcm24:
                self._in_buf.extend(pcm24)
            # Enviar SÓLO en bloques alineados a Mimi (80ms); si no, el modelo no
            # avanza sus pasos y no devuelve audio.
            while len(self._in_buf) >= self._MIMI_CHUNK:
                chunk = bytes(self._in_buf[: self._MIMI_CHUNK])
                del self._in_buf[: self._MIMI_CHUNK]
                await self._client.send_pcm(chunk)
                self._in_n += 1
                self._in_bytes += len(chunk)
                if self._in_n % 25 == 0:
                    logger.info(
                        "MoshiBridge IN: %d bloques 80ms, %d bytes->moshi (src_rate=%s, pico=%d/32767)",
                        self._in_n, self._in_bytes, frame.sample_rate, getattr(self, "_in_peak", 0),
                    )
                    self._in_peak = 0
        except Exception as e:
            logger.warning("MoshiBridge input error: %s", e)

    async def _emit_audio(self, pcm16_24k: bytes) -> None:
        try:
            pcm_out = await self._down.resample(pcm16_24k, MIMI_SAMPLE_RATE, self._out_rate)
            if pcm_out:
                await self.push_frame(
                    OutputAudioRawFrame(
                        audio=pcm_out, sample_rate=self._out_rate, num_channels=1
                    )
                )
                self._out_n += 1
                self._out_bytes += len(pcm_out)
                if self._out_n % 50 == 0:
                    logger.info(
                        "MoshiBridge OUT: %d frames, %d bytes->Telnyx (rate=%d)",
                        self._out_n, self._out_bytes, self._out_rate,
                    )
        except Exception as e:
            logger.warning("MoshiBridge output error: %s", e)

    async def _emit_text(self, text: str) -> None:
        if self._on_transcript:
            try:
                self._on_transcript("agent", text)
            except Exception:
                pass

    async def _stop(self) -> None:
        self._active = False
        if self._supervisor_task:
            self._supervisor_task.cancel()
            self._supervisor_task = None
        if self._client:
            await self._client.close()
            self._client = None
