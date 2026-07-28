# voice-pipecat — Voz sin LiveKit (Telnyx Media Streaming + Pipecat + PersonaPlex)

Track **paralelo y experimental** al worker de LiveKit (`voice-worker/`). **No lo
reemplaza ni lo borra**: existe para probar la integración **definitiva de
modelos realtime full-duplex (PersonaPlex/Moshi) sin depender de LiveKit**.
Ambos workers comparten el mismo contrato interno de Riverz
(`/api/internal/voice/context|tool|result`) y la misma base de datos, así que
las llamadas hechas por cualquiera aparecen igual en la app.

## Por qué existe

LiveKit Agents está pensado para pipelines por turnos (STT→LLM→TTS). Un modelo
**full-duplex** (escucha y habla a la vez por WebSocket) como PersonaPlex/Moshi
no encaja ahí — el plugin oficial de LiveKit para PersonaPlex es experimental y
su `generate_reply` no está implementado, así que no emite audio en una llamada.

Este worker usa el camino que sí encaja y que NVIDIA documenta con Twilio Media
Streams: audio de la llamada por **WebSocket bidireccional** ↔ el WebSocket S2S
del modelo, sin capa de turnos.

```
PSTN ─ Telnyx (TeXML <Connect><Stream bidirectionalMode="rtp">) ─ /ws
     ─ Pipecat (FastAPIWebsocketTransport + TelnyxFrameSerializer)
     ─ MoshiBridge ─ PersonaPlex/Moshi (moshi.server WS en Modal)
```

## Archivos

| Archivo | Qué hace |
|---|---|
| `bot.py` | FastAPI: `/health`, `/dial`, `/answer` (TeXML), `/ws` (media). Resuelve el contexto en Riverz y arma el pipeline (full-duplex **o** pipeline). |
| `moshi_bridge.py` | `FrameProcessor` de Pipecat: puente audio de la llamada ↔ moshi.server (resampleo 8k↔24k). |
| `moshi_client.py` | Cliente WS del protocolo de `moshi.server` (handshake, framing tag+Opus vía `sphn`). |
| `riverz_api.py` | Cliente del contrato interno de Riverz (copia del de `voice-worker/`). |
| `Dockerfile` / `requirements.txt` | Deploy como **Web Service** (Telnyx necesita URL pública). |

## Variables de entorno

```
RIVERZ_BASE_URL         https://riverz.co
VOICE_WORKER_SECRET     (mismo secreto que usa voice-worker/)
PUBLIC_URL              https://<este-servicio>            # p/ TeXML + WSS
TELNYX_API_KEY          (gestión de llamadas/números)
TELNYX_ACCOUNT_SID      (para colocar salientes vía TeXML API)
TELNYX_APPLICATION_SID  (TeXML Application)
TELNYX_PHONE_NUMBER     DID por defecto (fallback del caller ID)
DEEPGRAM_API_KEY        (sólo modo pipeline)
ANTHROPIC_API_KEY       (sólo modo pipeline)
ELEVENLABS_API_KEY      (sólo modo pipeline)
FISH_API_KEY            (sólo modo pipeline, si el TTS es Fish Audio)
```

El **motor** (full-duplex vs pipeline) lo decide el campo `mode` del contexto
que devuelve Riverz (`voice_model_config`, admin). En `realtime` + `realtime.base_url`
apuntando a la URL de Modal de PersonaPlex, usa `MoshiBridge`; si no, el pipeline
(Deepgram + Anthropic + ElevenLabs).

## Setup en Telnyx

1. **TeXML Application** → *Voice → TeXML Applications*. En "Voice URL" pon
   `https://<PUBLIC_URL>/answer` (método POST). Copia su `Application SID`.
2. **Número (DID)**: cómpralo y asígnalo a esa TeXML Application (entrantes).
3. **Media Streaming**: no requiere config global — el `<Stream>` del TeXML lo
   activa por llamada. Telnyx envía **PCMU 8 kHz**; el serializer lo maneja.
4. Salientes: `POST /dial {"call_id": "..."}` coloca la llamada vía la TeXML
   Calls API (`To`=teléfono del contacto, `From`=DID del workspace).

## Probar

- **Entrante**: apuntá la TeXML App al `/answer` y llamá al DID. `/ws` resuelve
  workspace/agente por el DID (igual que el worker de LiveKit).
- **Saliente**: `curl -X POST $PUBLIC_URL/dial -H 'content-type: application/json' -d '{"call_id":"<uuid de voice_calls>"}'`.

## Notas de versión (pipecat cambia rápido)

Escrito contra pipecat `main` (2026-07-25). Puntos marcados `# VERSION` en el
código si tu pin difiere:
- `services` en `pipecat.services.<vendor>.<type>`.
- VAD en `LLMUserAggregatorParams(vad_analyzer=...)` (en versiones viejas iba en
  `FastAPIWebsocketParams`).
- `PipelineTask`/`PipelineRunner` clásicos (siguen existiendo en main).
El modo **full-duplex no depende de nada de eso** (sólo transport + serializer +
`FrameProcessor`), que es la parte estable y el objetivo de este track.

## Qué NO hace

- No toca ni borra `voice-worker/` (LiveKit), VoxCPM ni el deploy de PersonaPlex
  en Modal. Todo sigue vivo para comparar.
- La captura de transcripción en modo pipeline es mínima (TODO); el modo
  full-duplex reporta los tokens de texto del modelo.
