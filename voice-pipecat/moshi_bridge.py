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
        self._recv_task: asyncio.Task | None = None
        self._start_task: asyncio.Task | None = None
        self._up = create_stream_resampler()   # entrada  pipeline_rate -> 24k
        self._down = create_stream_resampler()  # salida   24k -> out_rate
        self._out_rate = 8000

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        # OBLIGATORIO: la base maneja Start/End/Cancel/interrupciones.
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            self._out_rate = getattr(frame, "audio_out_sample_rate", None) or 8000
            # Empuja StartFrame PRIMERO (que el pipeline arranque) y conecta a
            # moshi en segundo plano; si bloqueáramos aquí, el transport de
            # salida nunca recibe StartFrame.
            await self.push_frame(frame, direction)
            self._start_task = asyncio.create_task(self._start())
        elif isinstance(frame, (EndFrame, CancelFrame)):
            await self._stop()
            await self.push_frame(frame, direction)
        elif isinstance(frame, InputAudioRawFrame):
            await self._forward_input(frame)
            # No re-empujamos el input: la salida la produce el modelo.
        else:
            await self.push_frame(frame, direction)

    async def _start(self) -> None:
        try:
            self._client = MoshiClient(
                self._url, self._auth, voice=self._voice, text_prompt=self._text_prompt
            )
            await self._client.connect()
            self._recv_task = asyncio.create_task(
                self._client.recv_loop(self._emit_audio, self._emit_text)
            )
            logger.info("MoshiBridge activo (voice=%s out_rate=%d)", self._voice, self._out_rate)
        except Exception as e:
            logger.error("MoshiBridge no pudo conectar a moshi: %s", e)
            self._client = None

    async def _forward_input(self, frame: InputAudioRawFrame) -> None:
        if not self._client:
            return
        try:
            pcm24 = await self._up.resample(frame.audio, frame.sample_rate, MIMI_SAMPLE_RATE)
            if pcm24:
                await self._client.send_pcm(pcm24)
        except Exception as e:
            logger.debug("MoshiBridge input error: %s", e)

    async def _emit_audio(self, pcm16_24k: bytes) -> None:
        try:
            pcm_out = await self._down.resample(pcm16_24k, MIMI_SAMPLE_RATE, self._out_rate)
            if pcm_out:
                await self.push_frame(
                    OutputAudioRawFrame(
                        audio=pcm_out, sample_rate=self._out_rate, num_channels=1
                    )
                )
        except Exception as e:
            logger.debug("MoshiBridge output error: %s", e)

    async def _emit_text(self, text: str) -> None:
        if self._on_transcript:
            try:
                self._on_transcript("agent", text)
            except Exception:
                pass

    async def _stop(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
            self._recv_task = None
        if self._client:
            await self._client.close()
            self._client = None
